import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateKryptonIdentity, fromHex, KryptonKeys } from '@/crypto/keys';
import { sendToNetwork, subscribeToInbox, sendUnsendSignal, onConnectivityChange } from '@/crypto/network';
import { encryptVault, decryptVault, getVaultKey } from '@/crypto/vault';
import { initContactRatchet, decryptWithPFS, decryptFromContact, type RatchetState } from '@/crypto/encryption';
import type { KryptonMessage, WalletState, Contact, ControlMessage } from '@/types';

const AI_CONTACT_ID = '05_AI_KRYPTON_ASSISTANT';

interface KryptonStore {
  // Identity & Keys — the Krypton ID is the chat identity. It never changes when a wallet connects.
  keys: KryptonKeys | null;
  generateKeys: () => void;
  loadKeysFromMnemonic: (mnemonic: string) => void;

  // Wallet — purely for crypto transfers, decoupled from chat identity/routing.
  linkWallet: (address: string) => void;

  // Messaging & Network
  messages: KryptonMessage[];
  isNetworkSyncing: boolean;
  addMessage: (msg: KryptonMessage) => void;
  clearMessages: () => void;
  startNetworkSync: () => void;

  // ── Unsend / Delete ──
  deleteMessage: (id: string) => void;
  unsendMessage: (id: string) => void;

  // ── Self-Destruct ──
  selfDestructTTL: number | null;   // Active TTL in seconds, or null if off
  setSelfDestructTimer: (ttlSeconds: number | null) => void;

  // ── Offline Queue ──
  offlineQueue: KryptonMessage[];
  isRelayConnected: boolean;
  flushOfflineQueue: () => void;

  // Contacts
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  removeContact: (id: string) => void;

  // Wallet
  walletState: WalletState | null;
  updateWalletBalance: (symbol: string, balance: number) => void;

  // ── Forward Secrecy ──
  ratchetStates: Record<string, RatchetState>;
  initRatchetForContact: (contactId: string) => Promise<void>;
}

export const useKryptonStore = create<KryptonStore>()(
  persist(
    (set, get) => ({
      keys: null,
      generateKeys: () => {
        const keys = generateKryptonIdentity();
        set({
          keys,
          walletState: {
            address: keys.ethAddress, // default linked wallet before MetaMask connects
            network: "Mainnet",
            assets: [
              { symbol: "ETH", name: "Ethereum", balance: 0.05, decimals: 18 },
              { symbol: "KRYP", name: "Krypton Token", balance: 1000.0, decimals: 18, contractAddress: "0x8920...2482" },
              { symbol: "USDC", name: "USD Coin", balance: 50.0, decimals: 6 }
            ]
          }
        });
        // Chat identity is ready the moment keys exist — start listening immediately.
        get().startNetworkSync();
      },
      loadKeysFromMnemonic: (mnemonic: string) => {
        // Implementation for loading existing mnemonic would go here
        // For now, it just re-generates
        get().generateKeys();
      },

      // MetaMask connecting/switching ONLY updates the linked wallet for transfers.
      // It never touches `keys` and never resubscribes the chat inbox.
      linkWallet: (address: string) => set((state) => ({
        walletState: state.walletState ? { ...state.walletState, address } : state.walletState
      })),

      messages: [],
      isNetworkSyncing: false,

      addMessage: (msg) => {
        set((state) => {
          // Prevent duplicates
          if (state.messages.find(m => m.id === msg.id)) return state;

          // If we are the sender, broadcast it to the network — ciphertext only, never plaintext.
          const { keys, selfDestructTTL, isRelayConnected } = get();
          if (keys && msg.sender === keys.kryptonId && !msg.isNetworkRelayed && msg.recipient !== AI_CONTACT_ID) {
            const { decryptedPayload, ...wireMsg } = msg;

            // Attach self-destruct TTL if active
            const wireMsgWithTTL = selfDestructTTL
              ? { ...wireMsg, isNetworkRelayed: true, selfDestructTTL }
              : { ...wireMsg, isNetworkRelayed: true };

            const sent = sendToNetwork(msg.recipient, wireMsgWithTTL);

            // If relay is offline, queue the message for later
            if (!sent && !isRelayConnected) {
              set((s) => ({
                offlineQueue: [...s.offlineQueue, { ...msg, isNetworkRelayed: false } as KryptonMessage]
              }));
            }
          }

          // Apply self-destruct timer to outgoing messages
          const finalMsg = selfDestructTTL
            ? { ...msg, selfDestructTTL, selfDestructAt: Date.now() + selfDestructTTL * 1000 }
            : msg;

          // Apply self-destruct timer to incoming messages that have a TTL
          const msgWithDestruct = (!selfDestructTTL && msg.selfDestructTTL)
            ? { ...msg, selfDestructAt: Date.now() + msg.selfDestructTTL * 1000 }
            : finalMsg;

          return { messages: [...state.messages, msgWithDestruct] };
        });
      },

      clearMessages: () => set({ messages: [] }),

      // ── Delete a message locally ──
      deleteMessage: (id: string) => set((state) => ({
        messages: state.messages.filter(m => m.id !== id)
      })),

      // ── Unsend a message (both sides) ──
      unsendMessage: (id: string) => {
        const { messages, keys } = get();
        const msg = messages.find(m => m.id === id);
        if (!msg || !keys) return;

        // Only the sender can unsend
        if (msg.sender !== keys.kryptonId) return;

        // Mark as tombstone locally
        set((state) => ({
          messages: state.messages.map(m =>
            m.id === id
              ? { ...m, isDeleted: true, deletedAt: Date.now(), decryptedPayload: undefined } as unknown as KryptonMessage
              : m
          ) as KryptonMessage[]
        }));

        // Broadcast unsend signal to the recipient
        if (msg.recipient !== AI_CONTACT_ID) {
          sendUnsendSignal(msg.recipient, id, keys.kryptonId);
        }
      },

      // ── Self-Destruct Timer ──
      selfDestructTTL: null,
      setSelfDestructTimer: (ttlSeconds: number | null) => set({ selfDestructTTL: ttlSeconds }),

      // ── Offline Queue ──
      offlineQueue: [],
      isRelayConnected: false,

      flushOfflineQueue: () => {
        const { offlineQueue, keys } = get();
        if (offlineQueue.length === 0 || !keys) return;

        for (const msg of offlineQueue) {
          const { decryptedPayload, ...wireMsg } = msg;
          sendToNetwork(msg.recipient, { ...wireMsg, isNetworkRelayed: true });
        }

        set({ offlineQueue: [] });
      },

      // Subscribes to this identity's inbox. Krypton ID never changes post-generation,
      // so this only ever needs to run once per identity (no wallet-triggered resubscribe).
      startNetworkSync: () => {
        const { keys } = get();
        if (!keys) return;
        set({ isNetworkSyncing: true });

        // Track relay connectivity
        onConnectivityChange((connected) => {
          set({ isRelayConnected: connected });
          if (connected) {
            // Flush any queued messages when we reconnect
            get().flushOfflineQueue();
          }
        });

        // Handle incoming control messages (unsend signals)
        const handleControlMessage = (ctrl: ControlMessage) => {
          if (ctrl.type === 'UNSEND') {
            set((state) => ({
              messages: state.messages.map(m =>
                m.id === ctrl.messageId && m.sender === ctrl.sender
                  ? { ...m, isDeleted: true, deletedAt: ctrl.timestamp, decryptedPayload: undefined } as unknown as KryptonMessage
                  : m
              ) as KryptonMessage[]
            }));
          }
        };

        subscribeToInbox(keys.kryptonId, async (incomingMsg: any) => {
          if (incomingMsg && incomingMsg.id && incomingMsg.sender && incomingMsg.encryptedPayload) {
            const { contacts, keys, addMessage, addContact } = get();
            if (!keys) return;

            const senderContact = contacts.find(c => c.id === incomingMsg.sender);
            let decryptedPayload = undefined;

            try {
              // The Krypton ID IS the sender's public key — decode it directly
              const senderPubKey = fromHex(incomingMsg.sender);
              
              if (incomingMsg.ratchetIndex !== undefined) {
                let state = get().ratchetStates[incomingMsg.sender];
                if (!state) {
                  state = await initContactRatchet(keys.messagingPrivateKey, senderPubKey, incomingMsg.sender);
                }
                const { plaintext, newState } = await decryptWithPFS(
                  incomingMsg.encryptedPayload,
                  state,
                  incomingMsg.ratchetIndex
                );
                decryptedPayload = plaintext;
                // Save updated ratchet state
                set(s => ({ ratchetStates: { ...s.ratchetStates, [incomingMsg.sender]: newState } }));
              } else {
                // Fallback for non-ratcheted messages
                decryptedPayload = await decryptFromContact(
                  incomingMsg.encryptedPayload,
                  keys.messagingPrivateKey,
                  senderPubKey
                );
              }
            } catch (err) {
              console.error("Decryption error:", err);
              decryptedPayload = "⚠️ [Decryption Failed]";
            }

            if (!senderContact) {
              // Auto-add unknown contact — the ID itself is already a full valid key, so this
              // contact is immediately correct and never needs manual repair.
              const colors = ['#58a6ff', '#3fb950', '#d2a8ff', '#ff7b72', '#f2cc60'];
              addContact({
                id: incomingMsg.sender,
                name: `${incomingMsg.sender.slice(0, 8)}...`,
                avatarColor: colors[Math.floor(Math.random() * colors.length)] as string
              });
            }

            const msg: any = {
              id: incomingMsg.id,
              timestamp: incomingMsg.timestamp || Date.now(),
              sender: incomingMsg.sender,
              recipient: incomingMsg.recipient,
              type: incomingMsg.type || 'ONION_ROUTED',
              encryptedPayload: incomingMsg.encryptedPayload,
              isCryptoTransfer: incomingMsg.isCryptoTransfer,
              transferAmount: incomingMsg.transferAmount,
              transferSymbol: incomingMsg.transferSymbol,
              ratchetIndex: incomingMsg.ratchetIndex,
              selfDestructTTL: incomingMsg.selfDestructTTL,
              isNetworkRelayed: true,
              metadataStripped: true,
              routePath: ['p2p-relay'],
              decryptedPayload,
            };

            addMessage(msg as KryptonMessage);
          }
        }, handleControlMessage);
      },

      contacts: [
        {
          id: AI_CONTACT_ID,
          name: 'Krypton AI',
          isAi: true,
          avatarColor: 'from-purple-500 to-indigo-500'
        }
      ],
      addContact: (contact) => set((state) => {
        const existing = state.contacts.findIndex(c => c.id === contact.id);
        if (existing === -1) return { contacts: [...state.contacts, contact] };
        const updated = [...state.contacts];
        updated[existing] = { ...updated[existing], ...contact }; // upsert, so a bad entry can be corrected
        return { contacts: updated };
      }),
      removeContact: (id) => set((state) => ({
        contacts: state.contacts.filter(c => c.id !== id)
      })),

      walletState: null,
      updateWalletBalance: (symbol, balance) => set((state) => {
        if (!state.walletState) return state;
        return {
          walletState: {
            ...state.walletState,
            assets: state.walletState.assets.map(a =>
              a.symbol === symbol ? { ...a, balance } : a
            )
          }
        };
      }),

      // ── Forward Secrecy ──
      ratchetStates: {},
      initRatchetForContact: async (contactId: string) => {
        const { keys, ratchetStates } = get();
        if (!keys || ratchetStates[contactId]) return;

        try {
          const theirPubKey = fromHex(contactId);
          const state = await initContactRatchet(keys.messagingPrivateKey, theirPubKey, contactId);
          set(s => ({
            ratchetStates: { ...s.ratchetStates, [contactId]: state }
          }));
        } catch (e) {
          console.error("Failed to init ratchet:", e);
        }
      }
    }),
    {
      name: 'krypton-storage',
      skipHydration: true, // App will manually trigger hydration after PIN unlock
      storage: {
        getItem: async (name) => {
          const vaultKey = getVaultKey();
          if (!vaultKey) return null; // Can't read without key
          
          const encryptedString = localStorage.getItem(name);
          if (!encryptedString) return null;

          try {
            const decryptedString = await decryptVault(encryptedString, vaultKey);
            return JSON.parse(decryptedString, (key, value) => {
              if (value && typeof value === 'object' && value.type === 'Uint8Array') {
                return new Uint8Array(value.data);
              }
              return value;
            });
          } catch (e) {
            console.error("Vault decryption failed:", e);
            throw new Error("Invalid PIN or Corrupted Vault");
          }
        },
        setItem: async (name, value) => {
          const vaultKey = getVaultKey();
          if (!vaultKey) return; // Silent fail if somehow we're saving without a key

          const jsonString = JSON.stringify(value, (key, val) => {
            if (val instanceof Uint8Array) {
              return { type: 'Uint8Array', data: Array.from(val) };
            }
            return val;
          });

          const encryptedString = await encryptVault(jsonString, vaultKey);
          localStorage.setItem(name, encryptedString);
        },
        removeItem: (name) => localStorage.removeItem(name),
      }
    }
  )
);
