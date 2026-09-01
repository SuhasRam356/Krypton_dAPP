import sodium from 'libsodium-wrappers';
import nacl from 'tweetnacl';
import {
  type RatchetState,
  computeSharedSecret,
  initRatchetPair,
  encryptWithRatchet,
  decryptWithRatchet,
} from './ratchet';

export type { RatchetState };

/**
 * Encrypts a payload for a specific recipient using authenticated public-key encryption.
 */
export async function encryptForContact(
  payload: string,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<string> {
  await sodium.ready;

  const messageBytes = sodium.from_string(payload);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderPrivateKey
  );

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
): Promise<string> {
  await sodium.ready;

  const combined = sodium.from_base64(encryptedPayloadBase64);
  if (combined.length <= sodium.crypto_box_NONCEBYTES) {
    throw new Error('Invalid encrypted payload');
  }

  const nonce = combined.slice(0, sodium.crypto_box_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_box_NONCEBYTES);

  const decryptedBytes = sodium.crypto_box_open_easy(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientPrivateKey
  );
  return sodium.to_string(decryptedBytes);
}

/**
 * Generates an ephemeral keypair. Kept for future Double Ratchet / X3DH work.
 */
export function generateEphemeralKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

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

import { type PublishedPreKeyBundle, verifyPreKeyBundle, computePreKeySharedSecret } from './prekeys';

/**
 * Initialize a send/recv ratchet pair using an offline PreKey bundle (X3DH-lite).
 */
export async function initContactRatchetWithPreKey(
  myPrivateKey: Uint8Array,
  bundle: PublishedPreKeyBundle,
  myKryptonId: string,
  theirKryptonId: string
): Promise<{ send: RatchetState; recv: RatchetState }> {
  const { fromHex } = await import('./keys');
  
  const isValid = await verifyPreKeyBundle(bundle);
  if (!isValid) {
    throw new Error('PreKey bundle signature verification failed');
  }

  const theirIdentityKey = fromHex(bundle.identityKey);
  const theirSignedPreKey = fromHex(bundle.signedPreKey);
  const theirOneTimePreKey = bundle.oneTimePreKeys.length > 0 && bundle.oneTimePreKeys[0]
    ? fromHex(bundle.oneTimePreKeys[0] as string)
    : undefined;

  const sharedSecret = await computePreKeySharedSecret(
    myPrivateKey,
    theirIdentityKey,
    theirSignedPreKey,
    theirOneTimePreKey
  );

  return initRatchetPair(sharedSecret, myKryptonId, theirKryptonId);
}

/**
 * Encrypt with the symmetric ratchet. Returns ciphertext, updated state, and index.
 */
export async function encryptWithRatchetDemo(
  payload: string,
  ratchetState: RatchetState
): Promise<{ ciphertext: string; newState: RatchetState; ratchetIndex: number }> {
  const { ciphertext, newState, messageIndex } = await encryptWithRatchet(payload, ratchetState);
  return { ciphertext, newState, ratchetIndex: messageIndex };
}

/**
 * Decrypt with the symmetric ratchet.
 */
export async function decryptWithRatchetDemo(
  ciphertextBase64: string,
  ratchetState: RatchetState,
  ratchetIndex: number
): Promise<{ plaintext: string; newState: RatchetState }> {
  return decryptWithRatchet(ciphertextBase64, ratchetState, ratchetIndex);
}
