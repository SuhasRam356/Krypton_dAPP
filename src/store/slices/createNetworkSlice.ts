/**
 * Zustand slice: P2P Network & Gun Relay
 *
 * Owns the Gun inbox subscription, connectivity tracking, offline queue,
 * and the startNetworkSync lifecycle. The incoming-message handler that
 * decrypts payloads and dispatches to addMessage lives here so it can
 * coordinate with the crypto slice (ratchet states) and the message slice
 * (addMessage / addContact).
 */

import type { StateCreator } from 'zustand';
import type {
  Contact,
  ControlMessage,
  EncryptedControlMessage,
  KryptonMessage,
  MessageEnvelope,
  NetworkPayload,
  OnionRoutedMessage,
} from '@/types';
import {
  isRelayConnected as getNetworkRelayConnected,
  onConnectivityChange,
  sendToNetwork,
  subscribeToInbox,
  deleteFromNetwork,
  cleanupOldBuckets,
} from '@/crypto/network';
import {
  decryptFromContact,
  decryptWithRatchetDemo,
} from '@/crypto/encryption';
import { isValidKryptonId, fromHex } from '@/crypto/keys';
import type { KryptonStore } from '../useKryptonStore';
import { AI_CONTACT_ID } from './createCryptoSlice';

// ── Slice interface ──

export interface NetworkSlice {
  isNetworkSyncing: boolean;
  isRelayConnected: boolean;
  offlineQueue: KryptonMessage[];
  startNetworkSync: () => void;
  flushOfflineQueue: () => void;
}

// ── Module-level singletons for subscription cleanup ──

let stopConnectivityListener: (() => void) | null = null;
let stopInboxSubscription: (() => void) | null = null;
let syncedIdentity: string | null = null;

// ── Helpers ──

const nowMs = () => Date.now();

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
  const { decryptedPayload: _preview, ...wireMessage } = message;
  void _preview;
  return wireMessage;
}

function tombstoneMessage(message: KryptonMessage, deletedAt: number): KryptonMessage {
  const tombstone = { ...message, isDeleted: true, deletedAt } as Record<string, unknown>;
  delete tombstone.decryptedPayload;
  return tombstone as KryptonMessage;
}

// ── Slice creator ──

export const createNetworkSlice: StateCreator<KryptonStore, [], [], NetworkSlice> = (
  set,
  get
) => ({
  isNetworkSyncing: false,
  isRelayConnected: false,
  offlineQueue: [],

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
      if (connected) {
        get().flushOfflineQueue();
        
        // As a background cleanup, ask the network to drop our old time-buckets
        void cleanupOldBuckets(keys.kryptonId, 2).catch((err) => {
          console.error('Failed to run bucket cleanup:', err);
        });
      }
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

      // --- AUTO-SCRUBBING ---
      // Once successfully processed, permanently delete the control message from the P2P network.
      void deleteFromNetwork(keys.kryptonId, incomingMessage.id, incomingMessage.timestamp).catch((err) => {
        console.error('Failed to scrub control message from network after receipt:', err);
      });
    };

    // Track message IDs we've already processed to prevent Gun replays
    // from consuming ratchet keys (Gun fires .on() for ALL data in a node).
    const seenMessageIds = new Set<string>();

    const handleIncomingOnionMessage = async (incomingMessage: OnionRoutedMessage) => {
      if (
        !isValidKryptonId(incomingMessage.sender) ||
        incomingMessage.recipient !== keys.kryptonId
      )
        return;

      // Deduplicate: Gun replays all messages when .map().on() fires
      if (seenMessageIds.has(incomingMessage.id)) return;
      // Also skip messages already in the store (e.g. from a previous session)
      if (get().messages.some((m) => m.id === incomingMessage.id)) {
        seenMessageIds.add(incomingMessage.id);
        return;
      }
      seenMessageIds.add(incomingMessage.id);

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
      let attachment: { data: string; filename: string; mimeType: string; size: number } | undefined;

      try {
        let plaintext: string;
        if (typeof incomingMessage.ratchetIndex === 'number') {
          let ratchetState = get().ratchetStates[incomingMessage.sender];
          
          if (!ratchetState && incomingMessage.initializationPayload) {
            // It's the first message from this sender, init using their payload
            const theirIdentityKey = incomingMessage.sender.slice(2); // remove '05' prefix
            ratchetState = await get().initRatchetFromPayload(
              incomingMessage.sender, 
              theirIdentityKey, 
              incomingMessage.initializationPayload
            ) ?? undefined;
          }

          if (!ratchetState) {
            throw new Error('Could not establish ratchet session with sender');
          }

          const result = await decryptWithRatchetDemo(
            incomingMessage.encryptedPayload,
            ratchetState,
            incomingMessage.ratchetIndex
          );
          plaintext = result.plaintext;
          set((state) => ({
            ratchetStates: {
              ...state.ratchetStates,
              [incomingMessage.sender]: result.newState,
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
          attachment = envelope.attachment;
        } else {
          // Legacy message support: older Krypton builds encrypted raw text only.
          decryptedPayload = plaintext;
        }
      } catch (error) {
        console.warn(
          'Skipped undecryptable message from',
          incomingMessage.sender,
          ':',
          error instanceof Error ? error.message : error
        );
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
        ...(attachment ? { attachment } : {}),
      };

      addMessage(message);

      // --- AUTO-SCRUBBING ---
      // Once successfully processed, permanently delete the message from the P2P network.
      // This prevents P2P inboxes from acting as a permanent storage layer.
      void deleteFromNetwork(keys.kryptonId, incomingMessage.id, incomingMessage.timestamp).catch((err) => {
        console.error('Failed to scrub message from network after receipt:', err);
      });
    };

    stopInboxSubscription = subscribeToInbox(
      keys.kryptonId,
      (incomingMessage) => {
        if (isEncryptedControlMessage(incomingMessage)) {
          void handleEncryptedControlMessage(incomingMessage).catch((error) => {
            console.warn('Encrypted control message failed:', error instanceof Error ? error.message : error);
          });
          return;
        }

        if (isIncomingOnionMessage(incomingMessage)) {
          void handleIncomingOnionMessage(incomingMessage).catch((error) => {
            console.warn('Incoming onion message failed:', error instanceof Error ? error.message : error);
          });
        }
      },
      handleLegacyControlMessage
    );
  },
});
