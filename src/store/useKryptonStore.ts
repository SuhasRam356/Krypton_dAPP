import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateKryptonIdentity, fromHex, KryptonKeys } from '@/crypto/keys';
import { sendToNetwork, subscribeToInbox, onConnectivityChange } from '@/crypto/network';
import { encryptVault, decryptVault, getVaultKey } from '@/crypto/vault';
import { initContactRatchet, decryptWithPFS, decryptFromContact, encryptWithPFS, encryptForContact, type RatchetState } from '@/crypto/encryption';
import type { KryptonMessage, WalletState, Contact, InnerEnvelope } from '@/types';

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
  ratchetStates: Record<string, { send: RatchetState; recv: RatchetState }>;
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
        try {
          const keys = generateKryptonIdentity(mnemonic);
          set({ keys });
          get().startNetworkSync();
        } catch (e) {
          console.error("Invalid mnemonic", e);
          throw e; // Let the UI handle the error
        }
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
            const wireMsg = { ...msg };
            delete wireMsg.decryptedPayload;

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
      unsendMessage: async (id: string) => {
        const { messages, keys, ratchetStates } = get();
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

        // Broadcast unsend signal to the recipient securely
        if (msg.recipient !== AI_CONTACT_ID) {
          const innerEnv: InnerEnvelope = {
            type: 'UNSEND',
            id: id,
            sender: keys.kryptonId,
            recipient: msg.recipient,
            timestamp: Date.now(),
            payload: id // payload is target message id
          };

          let ciphertext = "";
          let ratchetIndex: number | undefined = undefined;
          
          const pair = ratchetStates[msg.recipient];
          if (pair) {
            ratchetIndex = pair.send.messageIndex;
            innerEnv.ratchetIndex = ratchetIndex;
            const result = await encryptWithPFS(innerEnv, pair.send);
            ciphertext = result.ciphertext;
            set(s => ({
              ratchetStates: { ...s.ratchetStates, [msg.recipient]: { ...pair!, send: result.newState } }
            }));
          } else {
            const targetPubKey = fromHex(msg.recipient);
            ciphertext = await encryptForContact(innerEnv, keys.messagingPrivateKey, targetPubKey);
          }

          const wireMsg = {
            sender: keys.kryptonId,
            recipient: msg.recipient,
            encryptedPayload: ciphertext,
            ratchetIndex
          };
          
          sendToNetwork(msg.recipient, { ...wireMsg, isNetworkRelayed: true });
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
          const wireMsg = { ...msg };
          delete wireMsg.decryptedPayload;
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

        subscribeToInbox(keys.kryptonId, async (rawMsg: Record<string, unknown>) => {
          const incomingMsg = rawMsg as {
            id?: string;
            sender?: string;
            recipient?: string;
            encryptedPayload?: string;
            ratchetIndex?: number;
            timestamp?: number;
            type?: 'ONION_ROUTED';
            isCryptoTransfer?: boolean;
            transferAmount?: number;
            transferSymbol?: string;
            selfDestructTTL?: number;
          };

          if (incomingMsg && incomingMsg.sender && incomingMsg.encryptedPayload) {
            const { contacts, keys, addMessage, addContact } = get();
            if (!keys) return;

            const senderContact = contacts.find(c => c.id === incomingMsg.sender);
            let inner: InnerEnvelope | undefined = undefined;

            try {
              // The Krypton ID IS the sender's public key — decode it directly
              const senderPubKey = fromHex(incomingMsg.sender);
              
              if (incomingMsg.ratchetIndex !== undefined) {
                let pair = get().ratchetStates[incomingMsg.sender];
                if (!pair) {
                  pair = await initContactRatchet(keys.messagingPrivateKey, senderPubKey, keys.kryptonId, incomingMsg.sender);
                }
                const { plaintext, newState } = await decryptWithPFS(
                  incomingMsg.encryptedPayload,
                  pair.recv,
                  incomingMsg.ratchetIndex
                );
                inner = plaintext;
                // Only the recv chain advances here — send chain is untouched, so our own
                // outgoing counter is never disturbed by incoming traffic.
                set(s => ({ ratchetStates: { ...s.ratchetStates, [incomingMsg.sender as string]: { ...pair, recv: newState } } }));
              } else {
                // Fallback for non-ratcheted messages
                inner = await decryptFromContact(
                  incomingMsg.encryptedPayload,
                  keys.messagingPrivateKey,
                  senderPubKey
                );
              }
            } catch (err) {
              console.error("Decryption error:", err);
              // Dropping forged or corrupt envelopes
              return;
            }

            if (!inner || inner.sender !== incomingMsg.sender) {
              console.warn("Message dropped: Sender spoofing detected. Inner sender does not match outer routing sender.");
              return;
            }

            if (inner.recipient !== keys.kryptonId) {
              console.warn("Message dropped: Envelope recipient mismatch.");
              return;
            }

            if (!senderContact) {
              // Auto-add unknown contact — the ID itself is already a full valid key, so this
              // contact is immediately correct and never needs manual repair.
              const colors = ['#58a6ff', '#3fb950', '#d2a8ff', '#ff7b72', '#f2cc60'];
              addContact({
                id: inner.sender,
                name: `${inner.sender.slice(0, 8)}...`,
                avatarColor: colors[Math.floor(Math.random() * colors.length)] as string
              });
            }

            if (inner.type === 'UNSEND') {
              // Handle authenticated unsend control signal
              set((state) => ({
                messages: state.messages.map(m =>
                  m.id === inner!.payload && m.sender === inner!.sender
                    ? { ...m, isDeleted: true, deletedAt: inner!.timestamp, decryptedPayload: undefined } as unknown as KryptonMessage
                    : m
                ) as KryptonMessage[]
              }));
              return;
            }

            const msg: KryptonMessage = {
              id: inner.id,
              timestamp: inner.timestamp,
              sender: inner.sender,
              recipient: inner.recipient,
              type: inner.type,
              encryptedPayload: incomingMsg.encryptedPayload as string,
              ...(inner.isCryptoTransfer && { isCryptoTransfer: true, transferAmount: inner.transferAmount, transferSymbol: inner.transferSymbol }),
              ...(inner.ratchetIndex !== undefined && { ratchetIndex: inner.ratchetIndex }),
              ...(inner.selfDestructTTL && { selfDestructTTL: inner.selfDestructTTL }),
              isNetworkRelayed: true,
              metadataStripped: true,
              routePath: ['p2p-relay'],
              decryptedPayload: inner.payload,
            };

            addMessage(msg);
          }
        });
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
          const pair = await initContactRatchet(keys.messagingPrivateKey, theirPubKey, keys.kryptonId, contactId);
          set(s => ({
            ratchetStates: { ...s.ratchetStates, [contactId]: pair }
          }));
        } catch (e) {
          console.error("Failed to init ratchet:", e);
        }
      }
    }),
    {
      name: 'krypton-storage',
      skipHydration: true, // App will manually trigger hydration after PIN unlock
      partialize: (state) => ({
        keys: state.keys,
        messages: state.messages,
        contacts: state.contacts,
        walletState: state.walletState,
        ratchetStates: state.ratchetStates,
        offlineQueue: state.offlineQueue,
        selfDestructTTL: state.selfDestructTTL,
      }),
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
