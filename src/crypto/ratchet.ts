/**
 * Simplified Forward Secrecy via HKDF-style Symmetric Key Ratchet
 *
 * Design: Each contact pair shares an initial secret derived from Curve25519 ECDH.
 * A chain key is advanced after every message using BLAKE2b (via libsodium's
 * crypto_generichash). Each message is encrypted with a unique message key
 * derived from the current chain key. The old chain key is deleted, providing
 * forward secrecy: compromise of the current key cannot decrypt past messages.
 *
 * This is the symmetric ratchet half of the Signal Double Ratchet protocol.
 * The DH ratchet half (X3DH + per-message key exchange) is omitted because it
 * requires a centralized prekey server — incompatible with our fully decentralized
 * Gun.js architecture.
 *
 * All crypto uses libsodium (already installed):
 * - crypto_generichash (BLAKE2b) as KDF
 * - crypto_secretbox_easy (XSalsa20-Poly1305) for symmetric encryption
 * - crypto_scalarmult (Curve25519 ECDH) for initial shared secret
 */

import sodium from 'libsodium-wrappers';

// ── Ratchet State ──
export interface RatchetState {
  chainKey: Uint8Array;     // Current chain key (32 bytes) — advances after each message
  messageIndex: number;     // How many messages have been sent with this ratchet
  contactId: string;        // Which contact this ratchet belongs to
}

/**
 * Derive the initial shared secret from our private key and their public key
 * using Curve25519 scalar multiplication (ECDH).
 */
export async function computeSharedSecret(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array
): Promise<Uint8Array> {
  await sodium.ready;
  // crypto_scalarmult gives us the raw ECDH shared secret
  return sodium.crypto_scalarmult(myPrivateKey, theirPublicKey);
}

/**
 * Initialize a new ratchet from a shared secret.
 * The chain key is derived via BLAKE2b with a domain-separation salt.
 */
export async function initRatchet(
  sharedSecret: Uint8Array,
  contactId: string
): Promise<RatchetState> {
  await sodium.ready;

  // Domain-separated KDF: BLAKE2b(sharedSecret, key="krypton-ratchet-v1")
  const salt = sodium.from_string('krypton-ratchet-v1');
  const chainKey = sodium.crypto_generichash(32, sharedSecret, salt);

  return {
    chainKey,
    messageIndex: 0,
    contactId
  };
}

/**
 * Advance the ratchet by one step.
 * Returns the message key for encrypting/decrypting the current message,
 * and a new RatchetState with the advanced chain key.
 *
 * The old chainKey is NOT retained — this is what provides forward secrecy.
 */
export async function ratchetAdvance(
  state: RatchetState
): Promise<{ messageKey: Uint8Array; newState: RatchetState }> {
  await sodium.ready;

  // Derive the message key: BLAKE2b(chainKey, key="message-key")
  const msgKeySalt = sodium.from_string('message-key');
  const messageKey = sodium.crypto_generichash(32, state.chainKey, msgKeySalt);

  // Advance the chain key: BLAKE2b(chainKey, key="chain-advance")
  const chainSalt = sodium.from_string('chain-advance');
  const nextChainKey = sodium.crypto_generichash(32, state.chainKey, chainSalt);

  return {
    messageKey,
    newState: {
      chainKey: nextChainKey,
      messageIndex: state.messageIndex + 1,
      contactId: state.contactId
    }
  };
}

/**
 * Encrypt a plaintext message using a message key (XSalsa20-Poly1305 via secretbox).
 * Returns base64(nonce || ciphertext).
 */
export async function ratchetEncrypt(
  plaintext: string,
  messageKey: Uint8Array
): Promise<string> {
  await sodium.ready;

  const messageBytes = sodium.from_string(plaintext);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(messageBytes, nonce, messageKey);

  // Combine nonce + ciphertext
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return sodium.to_base64(combined);
}

/**
 * Decrypt a ciphertext using a message key.
 * Expects base64(nonce || ciphertext).
 */
export async function ratchetDecrypt(
  ciphertextBase64: string,
  messageKey: Uint8Array
): Promise<string> {
  await sodium.ready;

  const combined = sodium.from_base64(ciphertextBase64);
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

  const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertext, nonce, messageKey);
  return sodium.to_string(decryptedBytes);
}

/**
 * Convenience: advance ratchet + encrypt in one call.
 * Returns the ciphertext, new ratchet state, and the message index used.
 */
export async function encryptWithRatchet(
  plaintext: string,
  state: RatchetState
): Promise<{ ciphertext: string; newState: RatchetState; messageIndex: number }> {
  const { messageKey, newState } = await ratchetAdvance(state);
  const ciphertext = await ratchetEncrypt(plaintext, messageKey);
  return { ciphertext, newState, messageIndex: state.messageIndex };
}

/**
 * Convenience: advance ratchet to a specific index + decrypt.
 * For receiving, we need to advance our receive ratchet to match the sender's index.
 */
export async function decryptWithRatchet(
  ciphertextBase64: string,
  state: RatchetState,
  targetIndex: number
): Promise<{ plaintext: string; newState: RatchetState }> {
  let currentState = state;

  // Fast-forward the ratchet to match the target index
  // (in case messages arrived out of order or we missed some)
  while (currentState.messageIndex < targetIndex) {
    const { newState } = await ratchetAdvance(currentState);
    currentState = newState;
  }

  // Now advance one more time to get the message key for this index
  const { messageKey, newState } = await ratchetAdvance(currentState);
  const plaintext = await ratchetDecrypt(ciphertextBase64, messageKey);

  return { plaintext, newState };
}
