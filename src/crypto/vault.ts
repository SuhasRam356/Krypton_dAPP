import sodium from 'libsodium-wrappers';

let vaultKey: Uint8Array | null = null;

export const getVaultKey = () => vaultKey;
export const setVaultKey = (key: Uint8Array | null) => { vaultKey = key; };

/**
 * Derives a 32-byte key from a PIN and a salt using Argon2id (Libsodium's default pwhash).
 */
export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  
  // Use interactive limits for fast UI response but decent security
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    pin,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT
  );
}

/**
 * Generates a random salt for password hashing
 */
export async function generateSalt(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
}

/**
 * Encrypts the vault payload using XSalsa20-Poly1305 (secretbox)
 * Returns a base64 string of: nonce + ciphertext
 */
export async function encryptVault(data: string, key: Uint8Array): Promise<string> {
  await sodium.ready;
  
  const messageBytes = sodium.from_string(data);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  
  const ciphertext = sodium.crypto_secretbox_easy(messageBytes, nonce, key);
  
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  
  return sodium.to_base64(combined);
}

/**
 * Decrypts the vault payload
 */
export async function decryptVault(ciphertextBase64: string, key: Uint8Array): Promise<string> {
  await sodium.ready;
  
  const combined = sodium.from_base64(ciphertextBase64);
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
  
  const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(decryptedBytes);
}
