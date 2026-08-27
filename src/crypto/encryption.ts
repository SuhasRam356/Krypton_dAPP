import sodium from 'libsodium-wrappers';
import nacl from 'tweetnacl';
import type { InnerEnvelope } from '@/types';

/**
 * Encrypts a payload for a specific recipient using their public key.
 * This mimics Session's robust Libsodium/NaCl payload encryption for onion routing.
 */
export async function encryptForContact(
  envelope: InnerEnvelope,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<string> {
  await sodium.ready;
  
  // Convert envelope to bytes
  const messageBytes = sodium.from_string(JSON.stringify(envelope));
  
  // Generate a random nonce
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  
  // Encrypt the message (Libsodium crypto_box easy)
  const ciphertext = sodium.crypto_box_easy(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderPrivateKey
  );
  
  // Combine nonce and ciphertext and return as base64
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  
  return sodium.to_base64(combined);
}

/**
 * Decrypts a payload received from a specific sender using their public key.
 */
export async function decryptFromContact(
  encryptedPayloadBase64: string,
  recipientPrivateKey: Uint8Array,
  senderPublicKey: Uint8Array
): Promise<InnerEnvelope> {
  await sodium.ready;
  
  const combined = sodium.from_base64(encryptedPayloadBase64);
  const nonce = combined.slice(0, sodium.crypto_box_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_box_NONCEBYTES);
  
  const decryptedBytes = sodium.crypto_box_open_easy(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientPrivateKey
  );
  
  const decryptedJson = sodium.to_string(decryptedBytes);
  return JSON.parse(decryptedJson) as InnerEnvelope;
}

/**
 * Generates an ephemeral keypair for perfect forward secrecy (PFS)
 */
export function generateEphemeralKeyPair() {
  return nacl.box.keyPair();
}

// ── Forward Secrecy (Ratchet-based) ──
// These functions wrap the ratchet module for use in the message pipeline.
// They fall back to static crypto_box if no ratchet state exists for a contact.

import {
  type RatchetState,
  computeSharedSecret,
  initRatchetPair,
  encryptWithRatchet,
  decryptWithRatchet
} from './ratchet';

export type { RatchetState };

/**
 * Initialize a send/recv ratchet pair for a contact using ECDH shared secret.
 */
export async function initContactRatchet(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  myKryptonId: string,
  theirKryptonId: string
): Promise<{ send: RatchetState; recv: RatchetState }> {
  const sharedSecret = await computeSharedSecret(myPrivateKey, theirPublicKey);
  return initRatchetPair(sharedSecret, myKryptonId, theirKryptonId);
}

/**
 * Encrypt with forward secrecy if ratchet state is available.
 * Returns the ciphertext, updated ratchet state, and ratchet index.
 */
export async function encryptWithPFS(
  envelope: InnerEnvelope,
  ratchetState: RatchetState
): Promise<{ ciphertext: string; newState: RatchetState; ratchetIndex: number }> {
  const { ciphertext, newState, messageIndex } = await encryptWithRatchet(JSON.stringify(envelope), ratchetState);
  return { ciphertext, newState, ratchetIndex: messageIndex };
}

/**
 * Decrypt with forward secrecy using the ratchet state.
 */
export async function decryptWithPFS(
  ciphertextBase64: string,
  ratchetState: RatchetState,
  ratchetIndex: number
): Promise<{ plaintext: InnerEnvelope; newState: RatchetState }> {
  const { plaintext: decryptedStr, newState } = await decryptWithRatchet(ciphertextBase64, ratchetState, ratchetIndex);
  return { plaintext: JSON.parse(decryptedStr) as InnerEnvelope, newState };
}
