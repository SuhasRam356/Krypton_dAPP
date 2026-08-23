import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Wallet } from 'ethers';
import nacl from 'tweetnacl';

export type KryptonKeys = {
  mnemonic: string;
  kryptonId: string; // Session-style identity: "05" + hex(messagingPublicKey). THIS is the chat identity.
  ethAddress: string; // Wallet-only address, derived from the same mnemonic but never used for chat routing.
  messagingPublicKey: Uint8Array;
  messagingPrivateKey: Uint8Array;
};

/** Hex helpers — used instead of base64 so the Krypton ID is copy/paste and QR friendly, Session-style. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^05/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Generates a full suite of cryptographic keys based on a single BIP39 mnemonic.
 *
 * Chat identity (kryptonId) is derived independently of any wallet — Session-style.
 * The Ethereum wallet is generated from the same mnemonic purely as a convenience
 * "linked wallet" for in-app crypto transfers; MetaMask can override the *displayed*
 * wallet address without ever touching chat identity or message routing.
 */
export function generateKryptonIdentity(): KryptonKeys {
  // 1. Generate Mnemonic (ADAMANT Style)
  const mnemonic = generateMnemonic(wordlist);
  const seed = mnemonicToSeedSync(mnemonic);

  // 2. Derive Ethereum Wallet (Status/Web3 Style) — wallet-only, never used for routing.
  const hdNode = Wallet.fromPhrase(mnemonic);
  const ethAddress = hdNode.address;

  // 3. Derive Curve25519 Keys for Messaging (Session Style)
  const messagingSeed = new Uint8Array(seed.slice(0, 32));
  const messagingKeys = nacl.box.keyPair.fromSecretKey(messagingSeed);
  const kryptonId = '05' + toHex(messagingKeys.publicKey);

  return {
    mnemonic,
    kryptonId,
    ethAddress,
    messagingPublicKey: messagingKeys.publicKey,
    messagingPrivateKey: messagingKeys.secretKey,
  };
}
