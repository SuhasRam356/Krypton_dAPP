import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateKryptonIdentity, fromHex, KryptonKeys } from '@/crypto/keys';
import { sendToNetwork, subscribeToInbox } from '@/crypto/network';
import { decryptFromContact } from '@/crypto/encryption';
import type { KryptonMessage, WalletState, Contact } from '@/types';

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

  // Contacts
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  removeContact: (id: string) => void;

  // Wallet
  walletState: WalletState | null;
  updateWalletBalance: (symbol: string, balance: number) => void;
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
          const { keys } = get();
          if (keys && msg.sender === keys.kryptonId && !msg.isNetworkRelayed && msg.recipient !== AI_CONTACT_ID) {
            const { decryptedPayload, ...wireMsg } = msg;
            sendToNetwork(msg.recipient, { ...wireMsg, isNetworkRelayed: true });
          }
          return { messages: [...state.messages, msg] };
        });
      },
      clearMessages: () => set({ messages: [] }),

      // Subscribes to this identity's inbox. Krypton ID never changes post-generation,
      // so this only ever needs to run once per identity (no wallet-triggered resubscribe).
      startNetworkSync: () => {
        const { keys } = get();
        if (!keys) return;
        set({ isNetworkSyncing: true });
        subscribeToInbox(keys.kryptonId, async (incomingMsg: any) => {
          if (incomingMsg && incomingMsg.id && incomingMsg.sender && incomingMsg.encryptedPayload) {
            const { contacts, keys, addMessage, addContact } = get();
            if (!keys) return;

            const senderContact = contacts.find(c => c.id === incomingMsg.sender);
            let decryptedPayload = undefined;

            try {
              // The Krypton ID IS the sender's public key — decode it directly, no separate
              // "public key" field to go stale or get mismatched.
              const senderPubKey = fromHex(incomingMsg.sender);
              decryptedPayload = await decryptFromContact(
                incomingMsg.encryptedPayload,
                keys.messagingPrivateKey,
                senderPubKey
              );
            } catch (err) {
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
              isNetworkRelayed: true,
              metadataStripped: true,
              routePath: ['p2p-relay'],
              decryptedPayload,
            };

            addMessage(msg as KryptonMessage);
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
      })
    }),
    {
      name: 'krypton-storage',
      // We explicitly tell persist to handle Uint8Arrays carefully — JSON.stringify strips them
      // by default, so we round-trip them manually.
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          return JSON.parse(str, (key, value) => {
            if (value && typeof value === 'object' && value.type === 'Uint8Array') {
              return new Uint8Array(value.data);
            }
            return value;
          });
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value, (key, val) => {
            if (val instanceof Uint8Array) {
              return { type: 'Uint8Array', data: Array.from(val) };
            }
            return val;
          }));
        },
        removeItem: (name) => localStorage.removeItem(name),
      }
    }
  )
);
