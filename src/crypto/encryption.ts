import sodium from 'libsodium-wrappers';
import nacl from 'tweetnacl';

/**
 * Encrypts a payload for a specific recipient using their public key.
 * This mimics Session's robust Libsodium/NaCl payload encryption for onion routing.
 */
export async function encryptForContact(
  payload: string,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<string> {
  await sodium.ready;
  
  // Convert payload to bytes
  const messageBytes = sodium.from_string(payload);
  
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
): Promise<string> {
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
  
  return sodium.to_string(decryptedBytes);
}

/**
 * Generates an ephemeral keypair for perfect forward secrecy (PFS)
 */
export function generateEphemeralKeyPair() {
  return nacl.box.keyPair();
}
