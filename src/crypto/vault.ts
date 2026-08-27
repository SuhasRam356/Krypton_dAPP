import sodium from 'libsodium-wrappers';

let vaultKey: Uint8Array | null = null;

const VAULT_KEY_BYTES = 32;
const VAULT_SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 310_000;

export const getVaultKey = () => vaultKey;
export const setVaultKey = (key: Uint8Array | null) => {
  vaultKey = key;
};

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API is required for vault key derivation');
  }
  return subtle;
}

/**
 * Derives a 32-byte key from a PIN and salt using PBKDF2-SHA256.
 *
 * Note: libsodium-wrappers (non-sumo) does not expose Argon2 pwhash in browsers.
 * PBKDF2 keeps the vault portable across browser and test environments; production
 * hardening should move to Argon2id via libsodium-wrappers-sumo or WebAssembly.
 */
export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const pinBytes = new TextEncoder().encode(pin);
  const saltBytes = new Uint8Array(salt.length);
  saltBytes.set(salt);

  const baseKey = await subtle.importKey('raw', pinBytes, 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    VAULT_KEY_BYTES * 8
  );

  return new Uint8Array(derivedBits);
}

/**
 * Generates a random salt for PIN-based key derivation.
 */
export async function generateSalt(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(VAULT_SALT_BYTES);
}

/**
 * Encrypts the vault payload using XSalsa20-Poly1305 (secretbox).
 * Returns a base64 string of: nonce + ciphertext.
 */
export async function encryptVault(data: string, key: Uint8Array): Promise<string> {
  await sodium.ready;

  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error('Invalid vault key length');
  }

  const messageBytes = sodium.from_string(data);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(messageBytes, nonce, key);

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return sodium.to_base64(combined);
}

/**
 * Decrypts the vault payload.
 */
export async function decryptVault(ciphertextBase64: string, key: Uint8Array): Promise<string> {
  await sodium.ready;

  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error('Invalid vault key length');
  }

  const combined = sodium.from_base64(ciphertextBase64);
  if (combined.length <= sodium.crypto_secretbox_NONCEBYTES) {
    throw new Error('Invalid vault ciphertext');
  }

  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

  const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(decryptedBytes);
}
