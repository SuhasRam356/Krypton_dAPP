import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  deriveKryptonIdentityFromMnemonic,
  fromHex,
  generateKryptonIdentity,
  isValidKryptonId,
  normalizeKryptonId,
  type KryptonKeys,
} from '@/crypto/keys';
import {
  isRelayConnected as getNetworkRelayConnected,
  onConnectivityChange,
  sendToNetwork,
  subscribeToInbox,
} from '@/crypto/network';
import { decryptVault, encryptVault, getVaultKey } from '@/crypto/vault';
import {
  decryptFromContact,
  decryptWithRatchetDemo,
  encryptForContact,
  initContactRatchet,
  type RatchetState,
} from '@/crypto/encryption';
import type {
  Contact,
  ControlMessage,
  EncryptedControlMessage,
  KryptonMessage,
  MessageEnvelope,
  NetworkPayload,
  OnionRoutedMessage,
  WalletAsset,
  WalletState,
} from '@/types';

export const AI_CONTACT_ID = '05_AI_KRYPTON_ASSISTANT';

const DEFAULT_ASSETS: WalletAsset[] = [
  { symbol: 'ETH', name: 'Ethereum', balance: 0.05, decimals: 18 },
  {
    symbol: 'KRYP',
    name: 'Krypton Token',
    balance: 1000,
    decimals: 18,
    contractAddress: '0x8920000000000000000000000000000000002482',
  },
  { symbol: 'USDC', name: 'USD Coin', balance: 50, decimals: 6 },
];

const AI_CONTACT: Contact = {
  id: AI_CONTACT_ID,
  name: 'Krypton AI',
  isAi: true,
  avatarColor: 'from-purple-500 to-indigo-500',
};

const nowMs = () => Date.now();
const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${nowMs()}-${Math.random().toString(36).slice(2)}`;

let stopConnectivityListener: (() => void) | null = null;
let stopInboxSubscription: (() => void) | null = null;
let syncedIdentity: string | null = null;

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
  selfDestructTTL: number | null; // Active TTL in seconds, or null if off
  setSelfDestructTimer: (ttlSeconds: number | null) => void;

  // ── Offline Queue ──
  offlineQueue: KryptonMessage[];
  isRelayConnected: boolean;
  flushOfflineQueue: () => void;

  // Contacts
  contacts: Contact[];
  addContact: (contact: Contact) => boolean;
  removeContact: (id: string) => void;

  // Wallet
  walletState: WalletState | null;
  updateWalletBalance: (symbol: string, balance: number) => void;

  // ── Forward Secrecy Demo Ratchet ──
  ratchetStates: Record<string, { send: RatchetState; recv: RatchetState }>;
  initRatchetForContact: (contactId: string) => Promise<void>;
}

type PersistedKryptonState = Pick<
  KryptonStore,
  | 'keys'
  | 'messages'
  | 'contacts'
  | 'walletState'
  | 'ratchetStates'
  | 'offlineQueue'
  | 'selfDestructTTL'
>;

function createWalletState(keys: KryptonKeys): WalletState {
  return {
    address: keys.ethAddress,
    network: 'Mainnet',
    assets: DEFAULT_ASSETS.map((asset) => ({ ...asset })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIncomingOnionMessage(message: NetworkPayload): message is OnionRoutedMessage {
  return (
    isRecord(message) &&
    message.type === 'ONION_ROUTED' &&
    typeof message.id === 'string' &&
    typeof message.sender === 'string' &&
    typeof message.recipient === 'string' &&
    typeof message.encryptedPayload === 'string'
  );
}

function isEncryptedControlMessage(message: NetworkPayload): message is EncryptedControlMessage {
  return (
    isRecord(message) &&
    message.type === 'CONTROL' &&
    typeof message.id === 'string' &&
    typeof message.sender === 'string' &&
    typeof message.recipient === 'string' &&
    typeof message.encryptedPayload === 'string'
  );
}

function parseMessageEnvelope(plaintext: string): MessageEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.id !== 'string') return null;
    if (typeof parsed.timestamp !== 'number') return null;
    if (typeof parsed.sender !== 'string') return null;
    if (typeof parsed.recipient !== 'string') return null;
    if (typeof parsed.body !== 'string') return null;

    return parsed as MessageEnvelope;
  } catch {
    return null;
  }
}

function parseControlMessage(plaintext: string): ControlMessage | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== 1 || parsed.type !== 'UNSEND') return null;
    if (typeof parsed.messageId !== 'string') return null;
    if (typeof parsed.sender !== 'string') return null;
    if (typeof parsed.recipient !== 'string') return null;
    if (typeof parsed.timestamp !== 'number') return null;
    return parsed as ControlMessage;
  } catch {
    return null;
  }
}

function routePathFromIncoming(message: OnionRoutedMessage): string[] {
  if (
    Array.isArray(message.routePath) &&
    message.routePath.every((item) => typeof item === 'string')
  ) {
    return message.routePath;
  }
  return ['p2p-relay'];
}

function stripPlaintext(message: KryptonMessage): NetworkPayload | null {
  if (message.type !== 'ONION_ROUTED') return null;
  const { decryptedPayload: plaintextPreview, ...wireMessage } = message;
  void plaintextPreview;
  return wireMessage;
}

function tombstoneMessage(message: KryptonMessage, deletedAt: number): KryptonMessage {
  const tombstone = { ...message, isDeleted: true, deletedAt } as Record<string, unknown>;
  delete tombstone.decryptedPayload;
  return tombstone as KryptonMessage;
}

function withSelfDestruct(
  message: KryptonMessage,
  activeTtl: number | null,
  isOutgoing: boolean
): KryptonMessage {
  if (message.isDeleted || message.selfDestructAt) return message;
  const ttl = message.selfDestructTTL ?? (isOutgoing ? activeTtl : null);
  if (!ttl) return message;
  return {
    ...message,
    selfDestructTTL: ttl,
    selfDestructAt: nowMs() + ttl * 1000,
  };
}

function normalizeContact(contact: Contact, currentUserId?: string): Contact | null {
  if (contact.isAi || contact.id === AI_CONTACT_ID) {
    return { ...AI_CONTACT, ...contact, id: AI_CONTACT_ID, isAi: true };
  }

  const id = normalizeKryptonId(contact.id);
  if (!isValidKryptonId(id) || id === currentUserId) {
    return null;
  }

  const name = contact.name.trim();
  if (!name) return null;

  return {
    ...contact,
    id,
    name,
    addedAt: contact.addedAt ?? nowMs(),
  };
}

function mergeAiContact(contacts: Contact[]): Contact[] {
  const withoutDuplicateAi = contacts.filter(
    (contact) => contact.id !== AI_CONTACT_ID && !contact.isAi
  );
  return [AI_CONTACT, ...withoutDuplicateAi];
}

function sanitizePersistedState(
  value: unknown
): { state: PersistedKryptonState; version?: number } | null {
  if (!isRecord(value) || !isRecord(value.state)) return null;

  const persisted = value.state as Partial<PersistedKryptonState>;
  const keys = persisted.keys
    ? ({ ...persisted.keys, createdAt: persisted.keys.createdAt ?? nowMs() } as KryptonKeys)
    : null;

  return {
    state: {
      keys,
      messages: Array.isArray(persisted.messages) ? persisted.messages : [],
      contacts: mergeAiContact(Array.isArray(persisted.contacts) ? persisted.contacts : []),
      walletState: persisted.walletState ?? (keys ? createWalletState(keys) : null),
      ratchetStates: isRecord(persisted.ratchetStates) ? persisted.ratchetStates : {},
      offlineQueue: Array.isArray(persisted.offlineQueue) ? persisted.offlineQueue : [],
      selfDestructTTL:
        typeof persisted.selfDestructTTL === 'number' ? persisted.selfDestructTTL : null,
    },
    ...(typeof value.version === 'number' ? { version: value.version } : {}),
  };
}

async function sendEncryptedUnsendSignal(message: KryptonMessage, keys: KryptonKeys) {
  if (message.recipient === AI_CONTACT_ID || !isValidKryptonId(message.recipient)) return;

  const recipientPublicKey = fromHex(message.recipient);
  const timestamp = nowMs();
  const control: ControlMessage = {
    version: 1,
    type: 'UNSEND',
    messageId: message.id,
    sender: keys.kryptonId,
    recipient: message.recipient,
    timestamp,
  };

  const encryptedPayload = await encryptForContact(
    JSON.stringify(control),
    keys.messagingPrivateKey,
    recipientPublicKey
  );
  sendToNetwork(message.recipient, {
    id: createId(),
    timestamp,
    sender: keys.kryptonId,
    recipient: message.recipient,
    type: 'CONTROL',
    encryptedPayload,
    isNetworkRelayed: true,
  });
}

export const useKryptonStore = create<KryptonStore>()(
  persist<KryptonStore, [], [], PersistedKryptonState>(
    (set, get) => ({
      keys: null,
      generateKeys: () => {
        const keys = generateKryptonIdentity();
        set({
          keys,
          walletState: createWalletState(keys),
          contacts: mergeAiContact(get().contacts),
          ratchetStates: {},
        });
        get().startNetworkSync();
      },
      loadKeysFromMnemonic: (mnemonic: string) => {
        const keys = deriveKryptonIdentityFromMnemonic(mnemonic);
        set({
          keys,
          walletState: createWalletState(keys),
          contacts: mergeAiContact(get().contacts),
          ratchetStates: {},
        });
        get().startNetworkSync();
      },

      // MetaMask connecting/switching ONLY updates the linked wallet for transfers.
      // It never touches `keys` and never resubscribes the chat inbox.
      linkWallet: (address: string) =>
        set((state) => ({
          walletState: state.walletState ? { ...state.walletState, address } : state.walletState,
        })),

      messages: [],
      isNetworkSyncing: false,

      addMessage: (msg) => {
        if (get().messages.some((message) => message.id === msg.id)) return;

        const { keys, selfDestructTTL, isRelayConnected } = get();
        const isOutgoing = Boolean(keys && msg.sender === keys.kryptonId);
        const messageToStore = withSelfDestruct(msg, selfDestructTTL, isOutgoing);
        const wireMessage = stripPlaintext(messageToStore);
        const shouldBroadcast = Boolean(
          keys &&
          isOutgoing &&
          !messageToStore.isNetworkRelayed &&
          messageToStore.recipient !== AI_CONTACT_ID &&
          wireMessage
        );

        const sent =
          shouldBroadcast && wireMessage
            ? sendToNetwork(messageToStore.recipient, { ...wireMessage, isNetworkRelayed: true })
            : true;

        set((state) => {
          if (state.messages.some((message) => message.id === messageToStore.id)) return state;

          const nextState: Partial<KryptonStore> = {
            messages: [...state.messages, messageToStore],
          };

          if (!sent && !isRelayConnected) {
            nextState.offlineQueue = [
              ...state.offlineQueue,
              { ...messageToStore, isNetworkRelayed: false },
            ];
          }

          return nextState;
        });
      },

      clearMessages: () => set({ messages: [] }),

      // ── Delete a message locally ──
      deleteMessage: (id: string) =>
        set((state) => ({
          messages: state.messages.filter((message) => message.id !== id),
        })),

      // ── Unsend a message (both sides) ──
      unsendMessage: (id: string) => {
        const { messages, keys } = get();
        const message = messages.find((candidate) => candidate.id === id);
        if (!message || !keys || message.sender !== keys.kryptonId) return;

        const deletedAt = nowMs();
        set((state) => ({
          messages: state.messages.map((candidate) =>
            candidate.id === id ? tombstoneMessage(candidate, deletedAt) : candidate
          ),
        }));

        void sendEncryptedUnsendSignal(message, keys).catch((error) => {
          console.error('Failed to send encrypted unsend signal:', error);
        });
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

        const stillQueued: KryptonMessage[] = [];
        for (const queuedMessage of offlineQueue) {
          const wireMessage = stripPlaintext(queuedMessage);
          if (!wireMessage) continue;
          const sent = sendToNetwork(queuedMessage.recipient, {
            ...wireMessage,
            isNetworkRelayed: true,
          });
          if (!sent) stillQueued.push(queuedMessage);
        }

        set({ offlineQueue: stillQueued });
      },

      // Subscribes to this identity's inbox. Krypton ID never changes post-generation,
      // so this only needs to run once per identity unless the user restores a different mnemonic.
      startNetworkSync: () => {
        const { keys } = get();
        if (!keys) return;

        if (syncedIdentity === keys.kryptonId && get().isNetworkSyncing) {
          return;
        }

        stopConnectivityListener?.();
        stopInboxSubscription?.();
        syncedIdentity = keys.kryptonId;

        set({ isNetworkSyncing: true, isRelayConnected: getNetworkRelayConnected() });

        stopConnectivityListener = onConnectivityChange((connected) => {
          set({ isRelayConnected: connected });
          if (connected) get().flushOfflineQueue();
        });

        const handleLegacyControlMessage = (controlMessage: ControlMessage) => {
          if (controlMessage.type !== 'UNSEND') return;
          set((state) => ({
            messages: state.messages.map((message) =>
              message.id === controlMessage.messageId && message.sender === controlMessage.sender
                ? tombstoneMessage(message, controlMessage.timestamp)
                : message
            ),
          }));
        };

        const handleEncryptedControlMessage = async (incomingMessage: EncryptedControlMessage) => {
          if (
            !isValidKryptonId(incomingMessage.sender) ||
            incomingMessage.recipient !== keys.kryptonId
          )
            return;

          const senderPublicKey = fromHex(incomingMessage.sender);
          const plaintext = await decryptFromContact(
            incomingMessage.encryptedPayload,
            keys.messagingPrivateKey,
            senderPublicKey
          );
          const controlMessage = parseControlMessage(plaintext);
          if (!controlMessage) return;
          if (
            controlMessage.sender !== incomingMessage.sender ||
            controlMessage.recipient !== keys.kryptonId
          )
            return;

          handleLegacyControlMessage(controlMessage);
        };

        const handleIncomingOnionMessage = async (incomingMessage: OnionRoutedMessage) => {
          if (
            !isValidKryptonId(incomingMessage.sender) ||
            incomingMessage.recipient !== keys.kryptonId
          )
            return;

          const { contacts, addMessage, addContact } = get();
          const senderContact = contacts.find((contact) => contact.id === incomingMessage.sender);
          const senderPublicKey = fromHex(incomingMessage.sender);
          let decryptedPayload = '⚠️ [Decryption Failed]';
          let messageTimestamp =
            typeof incomingMessage.timestamp === 'number' ? incomingMessage.timestamp : nowMs();
          let isCryptoTransfer = incomingMessage.isCryptoTransfer;
          let transferAmount = incomingMessage.transferAmount;
          let transferSymbol = incomingMessage.transferSymbol;
          let selfDestructTTL = incomingMessage.selfDestructTTL;

          try {
            let plaintext: string;
            if (typeof incomingMessage.ratchetIndex === 'number') {
              let pair = get().ratchetStates[incomingMessage.sender];
              if (!pair) {
                pair = await initContactRatchet(
                  keys.messagingPrivateKey,
                  senderPublicKey,
                  keys.kryptonId,
                  incomingMessage.sender
                );
              }

              const result = await decryptWithRatchetDemo(
                incomingMessage.encryptedPayload,
                pair.recv,
                incomingMessage.ratchetIndex
              );
              plaintext = result.plaintext;
              set((state) => ({
                ratchetStates: {
                  ...state.ratchetStates,
                  [incomingMessage.sender]: { ...pair, recv: result.newState },
                },
              }));
            } else {
              plaintext = await decryptFromContact(
                incomingMessage.encryptedPayload,
                keys.messagingPrivateKey,
                senderPublicKey
              );
            }

            const envelope = parseMessageEnvelope(plaintext);
            if (envelope) {
              const envelopeMatchesWire =
                envelope.id === incomingMessage.id &&
                envelope.sender === incomingMessage.sender &&
                envelope.recipient === keys.kryptonId;

              if (!envelopeMatchesWire) {
                throw new Error('Encrypted message envelope does not match public wire metadata');
              }

              decryptedPayload = envelope.body;
              messageTimestamp = envelope.timestamp;
              isCryptoTransfer = envelope.isCryptoTransfer;
              transferAmount = envelope.transferAmount;
              transferSymbol = envelope.transferSymbol;
              selfDestructTTL = envelope.selfDestructTTL;
            } else {
              // Legacy message support: older Krypton builds encrypted raw text only.
              decryptedPayload = plaintext;
            }
          } catch (error) {
            console.error('Decryption error:', error);
          }

          if (!senderContact) {
            const colors = ['#58a6ff', '#3fb950', '#d2a8ff', '#ff7b72', '#f2cc60'];
            const avatarColor = colors[Math.floor(Math.random() * colors.length)] ?? '#58a6ff';
            addContact({
              id: incomingMessage.sender,
              name: `${incomingMessage.sender.slice(0, 8)}...`,
              avatarColor,
            });
          }

          const message: OnionRoutedMessage = {
            id: incomingMessage.id,
            timestamp: messageTimestamp,
            sender: incomingMessage.sender,
            recipient: incomingMessage.recipient,
            type: 'ONION_ROUTED',
            encryptedPayload: incomingMessage.encryptedPayload,
            metadataStripped: true,
            routePath: routePathFromIncoming(incomingMessage),
            decryptedPayload,
            isNetworkRelayed: true,
            ...(typeof incomingMessage.ratchetIndex === 'number'
              ? { ratchetIndex: incomingMessage.ratchetIndex }
              : {}),
            ...(isCryptoTransfer ? { isCryptoTransfer } : {}),
            ...(typeof transferAmount === 'number' ? { transferAmount } : {}),
            ...(typeof transferSymbol === 'string' ? { transferSymbol } : {}),
            ...(typeof selfDestructTTL === 'number' ? { selfDestructTTL } : {}),
          };

          addMessage(message);
        };

        stopInboxSubscription = subscribeToInbox(
          keys.kryptonId,
          (incomingMessage) => {
            if (isEncryptedControlMessage(incomingMessage)) {
              void handleEncryptedControlMessage(incomingMessage).catch((error) => {
                console.error('Encrypted control message failed:', error);
              });
              return;
            }

            if (isIncomingOnionMessage(incomingMessage)) {
              void handleIncomingOnionMessage(incomingMessage);
            }
          },
          handleLegacyControlMessage
        );
      },

      contacts: [AI_CONTACT],
      addContact: (contact) => {
        const normalizedContact = normalizeContact(contact, get().keys?.kryptonId);
        if (!normalizedContact) return false;

        set((state) => {
          const contacts = mergeAiContact(state.contacts);
          const existing = contacts.findIndex((candidate) => candidate.id === normalizedContact.id);
          if (existing === -1) return { contacts: [...contacts, normalizedContact] };

          const updated = [...contacts];
          updated[existing] = { ...updated[existing], ...normalizedContact };
          return { contacts: mergeAiContact(updated) };
        });
        return true;
      },
      removeContact: (id) =>
        set((state) => ({
          contacts: mergeAiContact(
            state.contacts.filter((contact) => contact.id !== id && !contact.isAi)
          ),
        })),

      walletState: null,
      updateWalletBalance: (symbol, balance) =>
        set((state) => {
          if (!state.walletState) return state;
          return {
            walletState: {
              ...state.walletState,
              assets: state.walletState.assets.map((asset) =>
                asset.symbol === symbol ? { ...asset, balance } : asset
              ),
            },
          };
        }),

      // ── Forward Secrecy Demo Ratchet ──
      ratchetStates: {},
      initRatchetForContact: async (contactId: string) => {
        const { keys, ratchetStates } = get();
        if (!keys || ratchetStates[contactId] || !isValidKryptonId(contactId)) return;

        try {
          const theirPublicKey = fromHex(contactId);
          const pair = await initContactRatchet(
            keys.messagingPrivateKey,
            theirPublicKey,
            keys.kryptonId,
            contactId
          );
          set((state) => ({
            ratchetStates: { ...state.ratchetStates, [contactId]: pair },
          }));
        } catch (error) {
          console.error('Failed to init ratchet:', error);
        }
      },
    }),
    {
      name: 'krypton-storage',
      skipHydration: true, // App manually triggers hydration after PIN unlock.
      partialize: (state) => ({
        keys: state.keys,
        messages: state.messages,
        contacts: mergeAiContact(state.contacts),
        walletState: state.walletState,
        ratchetStates: state.ratchetStates,
        offlineQueue: state.offlineQueue,
        selfDestructTTL: state.selfDestructTTL,
      }),
      storage: {
        getItem: async (name) => {
          const vaultKey = getVaultKey();
          if (!vaultKey) return null;

          const encryptedString = localStorage.getItem(name);
          if (!encryptedString) return null;

          try {
            const decryptedString = await decryptVault(encryptedString, vaultKey);
            const parsed = JSON.parse(decryptedString, (_key, value: unknown) => {
              if (isRecord(value) && value.type === 'Uint8Array' && Array.isArray(value.data)) {
                return new Uint8Array(value.data as number[]);
              }
              return value;
            }) as unknown;
            const sanitized = sanitizePersistedState(parsed);
            if (!sanitized) throw new Error('Invalid vault payload');
            return sanitized;
          } catch (error) {
            console.error('Vault decryption failed:', error);
            throw new Error('Invalid PIN or corrupted vault');
          }
        },
        setItem: async (name, value) => {
          const vaultKey = getVaultKey();
          if (!vaultKey) return;

          const jsonString = JSON.stringify(value, (_key, val: unknown) => {
            if (val instanceof Uint8Array) {
              return { type: 'Uint8Array', data: Array.from(val) };
            }
            return val;
          });

          const encryptedString = await encryptVault(jsonString, vaultKey);
          localStorage.setItem(name, encryptedString);
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
