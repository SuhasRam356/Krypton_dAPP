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
import type { DoubleRatchetState } from '@/crypto/ratchet';
import type { StateCreator } from 'zustand';
import type { KryptonStore } from '../useKryptonStore';

// ── Slice interface ──

export interface CryptoSlice {
  keys: KryptonKeys | null;
  generateKeys: () => void;
  loadKeysFromMnemonic: (mnemonic: string) => void;

  /** Per-contact Double Ratchet state, keyed by contact Krypton ID. */
  ratchetStates: Record<string, DoubleRatchetState>;
  
  /** Locally stored PreKey bundle private keys */
  localPreKeys: {
    signedPreKeyPrivate?: string; // hex
    kyberPrivateKey?: string; // hex
  } | null;

  initRatchetForContact: (contactId: string) => Promise<void>;
  
  /** Init as recipient using incoming initialization payload */
  initRatchetFromPayload: (
    contactId: string, 
    theirIdentityKey: string,
    payload: { ephemeralPublicKey: string; kyberCiphertext?: string }
  ) => Promise<DoubleRatchetState | null>;

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
  localPreKeys: null,

  initRatchetForContact: async (contactId: string) => {
    const { keys, ratchetStates } = get();
    const { isValidKryptonId, fromHex } = await import('@/crypto/keys');
    const { initContactRatchet } = await import('@/crypto/encryption');

    if (!keys || ratchetStates[contactId] || !isValidKryptonId(contactId)) return;

    try {
      const { fetchPreKeysFromGun } = await import('@/crypto/prekeys');
      const { getGun } = await import('@/crypto/network');
      
      const preKeyBundle = await fetchPreKeysFromGun(contactId, getGun() as any);
      let ratchetState;

      if (preKeyBundle) {
        const { initContactRatchetWithPreKey } = await import('@/crypto/encryption');
        ratchetState = await initContactRatchetWithPreKey(
          keys.messagingPrivateKey,
          preKeyBundle,
          keys.kryptonId,
          contactId
        );
        console.log(`Established session with ${contactId} via PreKey bundle`);
      } else {
        // Fallback to basic ECDH if no PreKey bundle is found
        const theirPublicKey = fromHex(contactId);
        ratchetState = await initContactRatchet(
          keys.messagingPrivateKey,
          theirPublicKey,
          keys.kryptonId,
          contactId
        );
        console.log(`Established basic session with ${contactId} (no PreKey bundle)`);
      }

      set((state) => ({
        ratchetStates: { ...state.ratchetStates, [contactId]: ratchetState },
      }));
    } catch (error) {
      console.error('Failed to init ratchet:', error);
    }
  },

  initRatchetFromPayload: async (contactId, theirIdentityKey, payload) => {
    const { keys, localPreKeys } = get();
    if (!keys) return null;

    try {
      const { computeRecipientSharedSecret } = await import('@/crypto/prekeys');
      const { initDoubleRatchet } = await import('@/crypto/ratchet');
      const { fromHex } = await import('@/crypto/keys');

      // Use local prekeys or fallback to dummy/empty if we lost them? We MUST have them for Kyber.
      // But for ECDH fallback, maybe they are empty.
      const myIdentityPrivateKey = keys.messagingPrivateKey;
      
      // We re-derive the signed prekey private key if it's missing in localPreKeys
      const sodium = (await import('libsodium-wrappers')).default;
      await sodium.ready;
      
      let signedPreKeyPrivate: Uint8Array;
      if (localPreKeys?.signedPreKeyPrivate) {
        signedPreKeyPrivate = fromHex(localPreKeys.signedPreKeyPrivate);
      } else {
        const preKeySeed = sodium.crypto_generichash(
          32,
          sodium.from_string('signed-prekey-seed-v1'),
          myIdentityPrivateKey
        );
        signedPreKeyPrivate = sodium.crypto_box_seed_keypair(preKeySeed).privateKey;
      }

      const theirIdentityKeyBytes = fromHex(theirIdentityKey);
      const theirEphemeralKeyBytes = fromHex(payload.ephemeralPublicKey);
      
      const kyberPriv = localPreKeys?.kyberPrivateKey ? fromHex(localPreKeys.kyberPrivateKey) : undefined;
      const kyberCiph = payload.kyberCiphertext ? fromHex(payload.kyberCiphertext) : undefined;

      const sharedSecret = await computeRecipientSharedSecret(
        myIdentityPrivateKey,
        signedPreKeyPrivate,
        theirIdentityKeyBytes,
        theirEphemeralKeyBytes,
        kyberPriv,
        kyberCiph
      );

      // isAlice is FALSE because we are the receiver (Bob)
      const state = await initDoubleRatchet(sharedSecret, contactId, theirEphemeralKeyBytes, false);
      
      set((s) => ({
        ratchetStates: { ...s.ratchetStates, [contactId]: state },
      }));
      return state;
    } catch (e) {
      console.error('Failed to init ratchet from payload:', e);
      return null;
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
      
      const localPreKeys: { signedPreKeyPrivate?: string; kyberPrivateKey?: string } = {};
      if (bundle.signedPreKeyPrivate) localPreKeys.signedPreKeyPrivate = bundle.signedPreKeyPrivate;
      if (bundle.kyberPrivateKey) localPreKeys.kyberPrivateKey = bundle.kyberPrivateKey;
      
      set({ localPreKeys });

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
