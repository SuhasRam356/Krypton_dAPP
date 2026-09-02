/**
 * Zustand slice: Messages, Contacts, Self-Destruct, Delete/Unsend
 *
 * Owns the messages array, contact list, self-destruct timer, and the
 * delete / unsend actions. Broadcast logic (sendToNetwork) stays here
 * because it is tightly coupled with the add-message flow.
 */

import type { StateCreator } from 'zustand';
import type {
  Contact,
  ControlMessage,
  KryptonMessage,
  OnionRoutedMessage,
  NetworkPayload,
} from '@/types';
import { isValidKryptonId, normalizeKryptonId, fromHex } from '@/crypto/keys';
import { encryptForContact } from '@/crypto/encryption';
import { sendToNetwork, deleteFromNetwork } from '@/crypto/network';
import type { KryptonStore } from '../useKryptonStore';
import { AI_CONTACT_ID, mergeAiContact, getAiContact } from './createCryptoSlice';

// ── Slice interface ──

export interface MessageSlice {
  messages: KryptonMessage[];
  addMessage: (msg: KryptonMessage) => void;
  clearMessages: () => void;

  deleteMessage: (id: string) => void;
  unsendMessage: (id: string) => void;

  selfDestructTTL: number | null;
  setSelfDestructTimer: (ttlSeconds: number | null) => void;

  contacts: Contact[];
  addContact: (contact: Contact) => boolean;
  removeContact: (id: string) => void;
}

// ── Helpers ──

const nowMs = () => Date.now();
const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${nowMs()}-${Math.random().toString(36).slice(2)}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripPlaintext(message: KryptonMessage): NetworkPayload | null {
  if (message.type !== 'ONION_ROUTED') return null;
  const { decryptedPayload: _preview, ...wireMessage } = message;
  void _preview;
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
    return { ...getAiContact(), ...contact, id: AI_CONTACT_ID, isAi: true };
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

async function sendEncryptedUnsendSignal(
  message: KryptonMessage,
  keys: { kryptonId: string; messagingPrivateKey: Uint8Array }
) {
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

// ── Slice creator ──

export const createMessageSlice: StateCreator<KryptonStore, [], [], MessageSlice> = (
  set,
  get
) => ({
  messages: [],

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

  deleteMessage: (id: string) => {
    const { messages, keys } = get();
    const message = messages.find((m) => m.id === id);
    if (!message || !keys) return;

    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    }));

    // Explicit P2P scrubbing
    // If sent message: acts as a silent unsend for unread messages.
    // If received message: cleans up our own inbox if it wasn't auto-scrubbed.
    const targetNode = message.sender === keys.kryptonId ? message.recipient : keys.kryptonId;
    void deleteFromNetwork(targetNode, message.id, message.timestamp).catch((err) => {
      console.error('Failed to scrub message from P2P node during deletion:', err);
    });
  },

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

    // Tell the recipient to unsend it locally
    void sendEncryptedUnsendSignal(message, keys).catch((error) => {
      console.error('Failed to send encrypted unsend signal:', error);
    });

    // Delete the original message from the P2P graph permanently
    void deleteFromNetwork(message.recipient, message.id, message.timestamp).catch((error) => {
      console.error('Failed to delete message from P2P graph:', error);
    });
  },

  selfDestructTTL: null,
  setSelfDestructTimer: (ttlSeconds: number | null) => set({ selfDestructTTL: ttlSeconds }),

  contacts: [getAiContact()],

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
});
