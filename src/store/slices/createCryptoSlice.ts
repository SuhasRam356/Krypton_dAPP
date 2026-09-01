/**
 * Zustand slice: Identity & Cryptographic Keys
 *
 * Owns key generation, mnemonic derivation, and the forward-secrecy
 * ratchet state map. Wallet linking is intentionally excluded — it lives
 * in the wallet slice because linking only affects the displayed ETH
 * address, never the chat identity.
 */

import {
  deriveKryptonIdentityFromMnemonic,
  generateKryptonIdentity,
  type KryptonKeys,
} from '@/crypto/keys';
import type { RatchetState } from '@/crypto/encryption';
import type { StateCreator } from 'zustand';
import type { KryptonStore } from '../useKryptonStore';

// ── Slice interface ──

export interface CryptoSlice {
  keys: KryptonKeys | null;
  generateKeys: () => void;
  loadKeysFromMnemonic: (mnemonic: string) => void;

  /** Per-contact send/recv ratchet pairs, keyed by contact Krypton ID. */
  ratchetStates: Record<string, { send: RatchetState; recv: RatchetState }>;
  initRatchetForContact: (contactId: string) => Promise<void>;

  /** Publish a PreKey bundle to the Gun network for offline session establishment */
  publishPreKeys: () => Promise<void>;
}

// ── Helpers shared with the old monolith ──

export const AI_CONTACT_ID = '05_AI_KRYPTON_ASSISTANT';

// ── Slice creator ──

export const createCryptoSlice: StateCreator<KryptonStore, [], [], CryptoSlice> = (set, get) => ({
  keys: null,

  generateKeys: () => {
    const keys = generateKryptonIdentity();
    set({
      keys,
      walletState: {
        address: keys.ethAddress,
        network: 'Mainnet',
        assets: getDefaultAssets(),
      },
      contacts: mergeAiContact(get().contacts),
      ratchetStates: {},
    });
    get().startNetworkSync();
    void get().publishPreKeys();
  },

  loadKeysFromMnemonic: (mnemonic: string) => {
    const keys = deriveKryptonIdentityFromMnemonic(mnemonic);
    set({
      keys,
      walletState: {
        address: keys.ethAddress,
        network: 'Mainnet',
        assets: getDefaultAssets(),
      },
      contacts: mergeAiContact(get().contacts),
      ratchetStates: {},
    });
    get().startNetworkSync();
    void get().publishPreKeys();
  },

  ratchetStates: {},

  initRatchetForContact: async (contactId: string) => {
    const { keys, ratchetStates } = get();
    const { isValidKryptonId, fromHex } = await import('@/crypto/keys');
    const { initContactRatchet } = await import('@/crypto/encryption');

    if (!keys || ratchetStates[contactId] || !isValidKryptonId(contactId)) return;

    try {
      const { fetchPreKeysFromGun } = await import('@/crypto/prekeys');
      const { getGun } = await import('@/crypto/network');
      
      const preKeyBundle = await fetchPreKeysFromGun(contactId, getGun() as any);
      let pair;

      if (preKeyBundle) {
        const { initContactRatchetWithPreKey } = await import('@/crypto/encryption');
        pair = await initContactRatchetWithPreKey(
          keys.messagingPrivateKey,
          preKeyBundle,
          keys.kryptonId,
          contactId
        );
        console.log(`Established session with ${contactId} via PreKey bundle`);
      } else {
        // Fallback to basic ECDH if no PreKey bundle is found
        const theirPublicKey = fromHex(contactId);
        pair = await initContactRatchet(
          keys.messagingPrivateKey,
          theirPublicKey,
          keys.kryptonId,
          contactId
        );
        console.log(`Established basic session with ${contactId} (no PreKey bundle)`);
      }

      set((state) => ({
        ratchetStates: { ...state.ratchetStates, [contactId]: pair },
      }));
    } catch (error) {
      console.error('Failed to init ratchet:', error);
    }
  },

  publishPreKeys: async () => {
    const { keys } = get();
    if (!keys) return;

    try {
      const { generatePreKeyBundle, toPublishedBundle, publishPreKeysToGun } = await import('@/crypto/prekeys');
      const { getGun } = await import('@/crypto/network');
      
      const bundle = await generatePreKeyBundle(keys.messagingPublicKey, keys.messagingPrivateKey);
      const publishedBundle = toPublishedBundle(bundle);
      
      publishPreKeysToGun(keys.kryptonId, publishedBundle, getGun() as any);
      console.log('PreKeys published to Gun network');
    } catch (error) {
      console.error('Failed to publish PreKeys:', error);
    }
  },
});

// ── Shared constants & helpers re-exported for other slices ──

import type { Contact, WalletAsset } from '@/types';

export function getDefaultAssets(): WalletAsset[] {
  return [
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
}

const AI_CONTACT: Contact = {
  id: AI_CONTACT_ID,
  name: 'Krypton AI',
  isAi: true,
  avatarColor: 'from-purple-500 to-indigo-500',
};

export function mergeAiContact(contacts: Contact[]): Contact[] {
  const withoutDuplicateAi = contacts.filter(
    (contact) => contact.id !== AI_CONTACT_ID && !contact.isAi
  );
  return [AI_CONTACT, ...withoutDuplicateAi];
}

export function getAiContact(): Contact {
  return AI_CONTACT;
}
