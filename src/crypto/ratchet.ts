/**
 * Simplified forward-secrecy demo via an HKDF-style symmetric key ratchet.
 *
 * This is intentionally described as a demo ratchet, not a production Signal
 * Double Ratchet. It rotates per-message symmetric keys and deletes old chain
 * keys, but the initial secret is still derived from long-term Curve25519 keys.
 * Production-grade deployments should use an audited X3DH/PQXDH + Double
 * Ratchet implementation such as libsignal.
 */

import sodium from 'libsodium-wrappers';

const MESSAGE_KEY_CONTEXT = 'krypton-ratchet-v1-message-key';
const CHAIN_ADVANCE_CONTEXT = 'krypton-ratchet-v1-chain-advance';
const MAX_SKIPPED_MESSAGE_KEYS = 50;

// ── Ratchet State ──
export interface RatchetState {
  chainKey: Uint8Array; // Current chain key (32 bytes) — advances after each message
  messageIndex: number; // Next message index expected on this chain
  contactId: string; // Which contact this ratchet belongs to
  skippedMessageKeys?: Record<number, Uint8Array>; // For bounded out-of-order delivery support
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
  return sodium.crypto_scalarmult(myPrivateKey, theirPublicKey);
}

/**
 * Initialize a send/recv ratchet PAIR from a shared secret.
 *
 * Two distinct chains avoid duplex-chat collisions. Both sides deterministically
 * agree which chain is used for each direction by comparing Krypton IDs.
 */
export async function initRatchetPair(
  sharedSecret: Uint8Array,
  myKryptonId: string,
  theirKryptonId: string
): Promise<{ send: RatchetState; recv: RatchetState }> {
  await sodium.ready;

  const saltA = sodium.from_string('krypton-ratchet-v1-chainA');
  const saltB = sodium.from_string('krypton-ratchet-v1-chainB');
  const chainA = sodium.crypto_generichash(32, sharedSecret, saltA);
  const chainB = sodium.crypto_generichash(32, sharedSecret, saltB);

  const iOwnChainA = myKryptonId < theirKryptonId;

  return {
    send: {
      chainKey: iOwnChainA ? chainA : chainB,
      messageIndex: 0,
      contactId: theirKryptonId,
      skippedMessageKeys: {},
    },
    recv: {
      chainKey: iOwnChainA ? chainB : chainA,
      messageIndex: 0,
      contactId: theirKryptonId,
      skippedMessageKeys: {},
    },
  };
}

/** @deprecated Unsafe for duplex chat — see initRatchetPair. */
export async function initRatchet(
  sharedSecret: Uint8Array,
  contactId: string
): Promise<RatchetState> {
  await sodium.ready;
  const salt = sodium.from_string('krypton-ratchet-v1');
  const chainKey = sodium.crypto_generichash(32, sharedSecret, salt);
  return { chainKey, messageIndex: 0, contactId, skippedMessageKeys: {} };
}

/**
 * Advance the ratchet by one step. The returned message key encrypts/decrypts
 * the current index, and the returned state has already forgotten the old chain
 * key.
 */
export async function ratchetAdvance(
  state: RatchetState
): Promise<{ messageKey: Uint8Array; newState: RatchetState }> {
  await sodium.ready;

  const messageKey = sodium.crypto_generichash(
    32,
    state.chainKey,
    sodium.from_string(MESSAGE_KEY_CONTEXT)
  );
  const nextChainKey = sodium.crypto_generichash(
    32,
    state.chainKey,
    sodium.from_string(CHAIN_ADVANCE_CONTEXT)
  );

  return {
    messageKey,
    newState: {
      ...state,
      chainKey: nextChainKey,
      messageIndex: state.messageIndex + 1,
      skippedMessageKeys: state.skippedMessageKeys ?? {},
    },
  };
}

/**
 * Encrypt a plaintext message using a message key (XSalsa20-Poly1305 via secretbox).
 * Returns base64(nonce || ciphertext).
 */
export async function ratchetEncrypt(plaintext: string, messageKey: Uint8Array): Promise<string> {
  await sodium.ready;

  const messageBytes = sodium.from_string(plaintext);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(messageBytes, nonce, messageKey);

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return sodium.to_base64(combined);
}

/**
 * Decrypt a ciphertext using a message key. Expects base64(nonce || ciphertext).
 */
export async function ratchetDecrypt(
  ciphertextBase64: string,
  messageKey: Uint8Array
): Promise<string> {
  await sodium.ready;

  const combined = sodium.from_base64(ciphertextBase64);
  if (combined.length <= sodium.crypto_secretbox_NONCEBYTES) {
    throw new Error('Invalid ratchet ciphertext');
  }

  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

  const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertext, nonce, messageKey);
  return sodium.to_string(decryptedBytes);
}

/**
 * Convenience: advance ratchet + encrypt in one call.
 */
export async function encryptWithRatchet(
  plaintext: string,
  state: RatchetState
): Promise<{ ciphertext: string; newState: RatchetState; messageIndex: number }> {
  const { messageKey, newState } = await ratchetAdvance(state);
  const ciphertext = await ratchetEncrypt(plaintext, messageKey);
  return { ciphertext, newState, messageIndex: state.messageIndex };
}

function pruneSkippedKeys(skipped: Record<number, Uint8Array>): Record<number, Uint8Array> {
  const entries = Object.entries(skipped)
    .map(([index, key]) => [Number(index), key] as const)
    .sort(([a], [b]) => a - b);

  while (entries.length > MAX_SKIPPED_MESSAGE_KEYS) {
    entries.shift();
  }

  return Object.fromEntries(entries);
}

/**
 * Convenience: advance ratchet to a specific index + decrypt.
 * Supports a bounded number of skipped message keys for out-of-order delivery.
 */
export async function decryptWithRatchet(
  ciphertextBase64: string,
  state: RatchetState,
  targetIndex: number
): Promise<{ plaintext: string; newState: RatchetState }> {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    throw new Error('Invalid ratchet index');
  }

  let currentState: RatchetState = {
    ...state,
    skippedMessageKeys: state.skippedMessageKeys ?? {},
  };

  if (targetIndex < currentState.messageIndex) {
    const skippedKey = currentState.skippedMessageKeys?.[targetIndex];
    if (!skippedKey) {
      throw new Error(
        'Message key is no longer available; possible replay or excessive reordering'
      );
    }

    const plaintext = await ratchetDecrypt(ciphertextBase64, skippedKey);
    const { [targetIndex]: _usedKey, ...remainingSkippedKeys } =
      currentState.skippedMessageKeys ?? {};
    void _usedKey;

    return {
      plaintext,
      newState: {
        ...currentState,
        skippedMessageKeys: remainingSkippedKeys,
      },
    };
  }

  if (targetIndex - currentState.messageIndex > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new Error('Too many skipped messages to safely fast-forward ratchet');
  }

  let skippedMessageKeys = { ...(currentState.skippedMessageKeys ?? {}) };

  while (currentState.messageIndex < targetIndex) {
    const skippedIndex = currentState.messageIndex;
    const { messageKey, newState } = await ratchetAdvance(currentState);
    skippedMessageKeys[skippedIndex] = messageKey;
    currentState = { ...newState, skippedMessageKeys };
  }

  skippedMessageKeys = pruneSkippedKeys(skippedMessageKeys);
  currentState = { ...currentState, skippedMessageKeys };

  const { messageKey, newState } = await ratchetAdvance(currentState);
  const plaintext = await ratchetDecrypt(ciphertextBase64, messageKey);

  return {
    plaintext,
    newState: {
      ...newState,
      skippedMessageKeys,
    },
  };
}
