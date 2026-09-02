/**
 * Krypton Store — composed from domain slices.
 *
 * Each slice owns a cohesive set of state and actions. The persist
 * middleware serialises a subset of all slices into the encrypted vault.
 *
 * Consumers continue to import `useKryptonStore` and `AI_CONTACT_ID`
 * exactly as before — the public API is unchanged.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { decryptVault, encryptVault, getVaultKey } from '@/crypto/vault';
import type { KryptonMessage, Contact, WalletState } from '@/types';
import type { KryptonKeys } from '@/crypto/keys';


import { createCryptoSlice, mergeAiContact, type CryptoSlice } from './slices/createCryptoSlice';
import { createMessageSlice, type MessageSlice } from './slices/createMessageSlice';
import { createNetworkSlice, type NetworkSlice } from './slices/createNetworkSlice';
import { createWalletSlice, type WalletSlice } from './slices/createWalletSlice';

// Re-export so existing consumers don't need to change their imports.
export { AI_CONTACT_ID } from './slices/createCryptoSlice';

// ── Composed store type ──

export type KryptonStore = CryptoSlice & MessageSlice & NetworkSlice & WalletSlice;

// ── Persisted subset ──

type PersistedKryptonState = Pick<
  KryptonStore,
  | 'keys'
  | 'messages'
  | 'contacts'
  | 'walletState'
  | 'ratchetStates'
  | 'localPreKeys'
  | 'offlineQueue'
  | 'selfDestructTTL'
>;

// ── Helpers ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePersistedState(
  value: unknown
): { state: PersistedKryptonState; version?: number } | null {
  if (!isRecord(value) || !isRecord(value.state)) return null;

  const persisted = value.state as Partial<PersistedKryptonState>;
  const keys = persisted.keys
    ? ({ ...persisted.keys, createdAt: persisted.keys.createdAt ?? Date.now() } as KryptonKeys)
    : null;

  return {
    state: {
      keys,
      messages: Array.isArray(persisted.messages) ? persisted.messages : [],
      contacts: mergeAiContact(Array.isArray(persisted.contacts) ? persisted.contacts : []),
      walletState: persisted.walletState ?? null,
      ratchetStates: isRecord(persisted.ratchetStates)
        ? (persisted.ratchetStates as Record<string, import('@/crypto/ratchet').DoubleRatchetState>)
        : {},
      localPreKeys: isRecord(persisted.localPreKeys) ? (persisted.localPreKeys as any) : null,
      offlineQueue: Array.isArray(persisted.offlineQueue)
        ? (persisted.offlineQueue as KryptonMessage[])
        : [],
      selfDestructTTL:
        typeof persisted.selfDestructTTL === 'number' ? persisted.selfDestructTTL : null,
    },
    ...(typeof value.version === 'number' ? { version: value.version } : {}),
  };
}

// ── Store ──

export const useKryptonStore = create<KryptonStore>()(
  persist<KryptonStore, [], [], PersistedKryptonState>(
    (...a) => ({
      ...createCryptoSlice(...a),
      ...createMessageSlice(...a),
      ...createNetworkSlice(...a),
      ...createWalletSlice(...a),
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
        localPreKeys: state.localPreKeys,
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
