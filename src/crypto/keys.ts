import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Wallet } from 'ethers';
import nacl from 'tweetnacl';

export const KRYPTON_ID_PREFIX = '05';
export const KRYPTON_PUBLIC_KEY_BYTES = 32;
export const KRYPTON_ID_HEX_LENGTH = KRYPTON_ID_PREFIX.length + KRYPTON_PUBLIC_KEY_BYTES * 2;

export type KryptonKeys = {
  mnemonic: string;
  kryptonId: string; // Session-style identity: "05" + hex(messagingPublicKey). THIS is the chat identity.
  ethAddress: string; // Wallet-only address, derived from the same mnemonic but never used for chat routing.
  messagingPublicKey: Uint8Array;
  messagingPrivateKey: Uint8Array;
  createdAt: number;
};

/** Hex helpers — used instead of base64 so the Krypton ID is copy/paste and QR friendly, Session-style. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeKryptonId(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidKryptonId(value: string): boolean {
  const normalized = normalizeKryptonId(value);
  return new RegExp(`^${KRYPTON_ID_PREFIX}[0-9a-f]{${KRYPTON_PUBLIC_KEY_BYTES * 2}}$`).test(
    normalized
  );
}

export function fromHex(hexOrKryptonId: string): Uint8Array {
  const normalized = normalizeKryptonId(hexOrKryptonId);
  const clean = normalized.startsWith(KRYPTON_ID_PREFIX)
    ? normalized.slice(KRYPTON_ID_PREFIX.length)
    : normalized;

  if (!/^[0-9a-f]+$/.test(clean) || clean.length !== KRYPTON_PUBLIC_KEY_BYTES * 2) {
    throw new Error('Invalid Krypton ID: expected 05-prefixed 32-byte Curve25519 public key');
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Deterministically derives the Krypton chat identity and Ethereum wallet from a BIP39 mnemonic.
 */
export function deriveKryptonIdentityFromMnemonic(
  mnemonic: string,
  createdAt = Date.now()
): KryptonKeys {
  const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');

  if (!validateMnemonic(normalizedMnemonic, wordlist)) {
    throw new Error('Invalid BIP39 recovery phrase');
  }

  const seed = mnemonicToSeedSync(normalizedMnemonic);
  const wallet = Wallet.fromPhrase(normalizedMnemonic);

  // Derive Curve25519 keys for messaging from the first 32 bytes of the BIP39 seed.
  // This is deterministic for recovery, but production systems should use a formally
  // specified KDF/path and audited protocol library before handling real secrets.
  const messagingSeed = new Uint8Array(seed.slice(0, 32));
  const messagingKeys = nacl.box.keyPair.fromSecretKey(messagingSeed);
  const kryptonId = KRYPTON_ID_PREFIX + toHex(messagingKeys.publicKey);

  return {
    mnemonic: normalizedMnemonic,
    kryptonId,
    ethAddress: wallet.address,
    messagingPublicKey: messagingKeys.publicKey,
    messagingPrivateKey: messagingKeys.secretKey,
    createdAt,
  };
}

/**
 * Generates a full suite of cryptographic keys based on a new BIP39 mnemonic.
 *
 * Chat identity (kryptonId) is derived independently of any wallet — Session-style.
 * The Ethereum wallet is generated from the same mnemonic purely as a convenience
 * "linked wallet" for in-app crypto transfers; MetaMask can override the *displayed*
 * wallet address without ever touching chat identity or message routing.
 */
export function generateKryptonIdentity(): KryptonKeys {
  const mnemonic = generateMnemonic(wordlist);
  return deriveKryptonIdentityFromMnemonic(mnemonic);
}
