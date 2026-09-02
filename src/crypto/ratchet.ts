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
import * as kyber from 'crystals-kyber';

const MESSAGE_KEY_CONTEXT = 'krypton-ratchet-v1-message-key';
const CHAIN_ADVANCE_CONTEXT = 'krypton-ratchet-v1-chain-advance';
const ROOT_ADVANCE_CONTEXT = 'krypton-ratchet-v1-root-advance';
const MAX_SKIPPED_MESSAGE_KEYS = 50;

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

// ── Ratchet State ──
export interface DoubleRatchetState {
  // DH Ratchet
  DHs: { publicKey: Uint8Array; privateKey: Uint8Array }; // Our DH Keypair
  DHr: Uint8Array | null; // Their DH Public Key

  // Symmetric Ratchet
  rootKey: Uint8Array; // 32-byte RK
  chainKeySend: Uint8Array | null; // 32-byte CKs
  chainKeyRecv: Uint8Array | null; // 32-byte CKr
  
  // Message indices
  messageIndexSend: number; // Ns
  messageIndexRecv: number; // Nr
  previousChainLength: number; // PN (messages sent in previous chain)
  
  contactId: string;
  skippedMessageKeys: Record<number, Uint8Array>;

  // X3DH + PQXDH payload for the first message (only for the initiator)
  initializationPayload?: {
    ephemeralPublicKey: string; // hex
    kyberCiphertext?: string; // hex
  };
}

/**
 * Initialize a Double Ratchet from a shared secret.
 * Used when establishing a session without PQXDH, or with PQXDH's resulting secret.
 */
export async function initDoubleRatchet(
  sharedSecret: Uint8Array,
  contactId: string,
  theirDHPublicKey: Uint8Array | null,
  isAlice: boolean // True if we are the initiator (we send the first message)
): Promise<DoubleRatchetState> {
  await sodium.ready;

  const DHs = sodium.crypto_box_keypair();
  
  let rootKey = sharedSecret;
  let chainKeySend: Uint8Array | null = null;
  let chainKeyRecv: Uint8Array | null = null;

  if (isAlice) {
    // Alice sends first. She doesn't have a chain key to send yet, 
    // it will be generated on her first ratchetAdvanceDH.
    // Wait, in Double Ratchet, Alice starts with a DH step to Bob's public key (if known).
    if (theirDHPublicKey) {
      const dhOutput = sodium.crypto_scalarmult(DHs.privateKey, theirDHPublicKey);
      const kdfInput = new Uint8Array(rootKey.length + dhOutput.length);
      kdfInput.set(rootKey);
      kdfInput.set(dhOutput, rootKey.length);
      
      const kdfOut = sodium.crypto_generichash(64, kdfInput, sodium.from_string(ROOT_ADVANCE_CONTEXT));
      rootKey = kdfOut.slice(0, 32);
      chainKeySend = kdfOut.slice(32, 64);
    }
  } else {
    // Bob is receiving first.
    // His chainKeyRecv will be established when he receives Alice's DHs.
  }

  return {
    DHs,
    DHr: theirDHPublicKey,
    rootKey,
    chainKeySend,
    chainKeyRecv,
    messageIndexSend: 0,
    messageIndexRecv: 0,
    previousChainLength: 0,
    contactId,
    skippedMessageKeys: {},
  };
}

/**
 * Step the DH Ratchet using a newly received DH public key.
 */
export async function ratchetAdvanceDH(
  state: DoubleRatchetState,
  newDHr: Uint8Array
): Promise<DoubleRatchetState> {
  await sodium.ready;
  
  // 1. Calculate DH(DHs, newDHr) to advance CKr
  let dhOutput = sodium.crypto_scalarmult(state.DHs.privateKey, newDHr);
  let kdfInput = new Uint8Array(state.rootKey.length + dhOutput.length);
  kdfInput.set(state.rootKey);
  kdfInput.set(dhOutput, state.rootKey.length);
  
  let kdfOut = sodium.crypto_generichash(64, kdfInput, sodium.from_string(ROOT_ADVANCE_CONTEXT));
  let rootKey = kdfOut.slice(0, 32);
  const chainKeyRecv = kdfOut.slice(32, 64);

  // 2. Generate a new DHs keypair
  const DHs = sodium.crypto_box_keypair();
  
  // 3. Calculate DH(new_DHs, newDHr) to advance CKs
  dhOutput = sodium.crypto_scalarmult(DHs.privateKey, newDHr);
  kdfInput = new Uint8Array(rootKey.length + dhOutput.length);
  kdfInput.set(rootKey);
  kdfInput.set(dhOutput, rootKey.length);
  
  kdfOut = sodium.crypto_generichash(64, kdfInput, sodium.from_string(ROOT_ADVANCE_CONTEXT));
  rootKey = kdfOut.slice(0, 32);
  const chainKeySend = kdfOut.slice(32, 64);

  return {
    ...state,
    DHs,
    DHr: newDHr,
    rootKey,
    chainKeySend,
    chainKeyRecv,
    previousChainLength: state.messageIndexSend,
    messageIndexSend: 0,
    messageIndexRecv: 0,
  };
}

/**
 * Step the symmetric ratchet for SENDING.
 */
export async function ratchetAdvanceSend(
  state: DoubleRatchetState
): Promise<{ messageKey: Uint8Array; newState: DoubleRatchetState }> {
  await sodium.ready;
  if (!state.chainKeySend) throw new Error("chainKeySend is null");

  const messageKey = sodium.crypto_generichash(
    32,
    state.chainKeySend,
    sodium.from_string(MESSAGE_KEY_CONTEXT)
  );
  const nextChainKey = sodium.crypto_generichash(
    32,
    state.chainKeySend,
    sodium.from_string(CHAIN_ADVANCE_CONTEXT)
  );

  return {
    messageKey,
    newState: {
      ...state,
      chainKeySend: nextChainKey,
      messageIndexSend: state.messageIndexSend + 1,
    },
  };
}

/**
 * Step the symmetric ratchet for RECEIVING.
 */
export async function ratchetAdvanceRecv(
  state: DoubleRatchetState
): Promise<{ messageKey: Uint8Array; newState: DoubleRatchetState }> {
  await sodium.ready;
  if (!state.chainKeyRecv) throw new Error("chainKeyRecv is null");

  const messageKey = sodium.crypto_generichash(
    32,
    state.chainKeyRecv,
    sodium.from_string(MESSAGE_KEY_CONTEXT)
  );
  const nextChainKey = sodium.crypto_generichash(
    32,
    state.chainKeyRecv,
    sodium.from_string(CHAIN_ADVANCE_CONTEXT)
  );

  return {
    messageKey,
    newState: {
      ...state,
      chainKeyRecv: nextChainKey,
      messageIndexRecv: state.messageIndexRecv + 1,
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
    throw new Error('Invalid encrypted payload (too short for nonce)');
  }
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
  const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertext, nonce, messageKey);
  return sodium.to_string(decryptedBytes);
}

/**
 * Encrypt a message using the Double Ratchet state.
 */
export async function encryptWithRatchet(
  payload: string,
  state: DoubleRatchetState
): Promise<{ ciphertext: string; newState: DoubleRatchetState; messageIndex: number }> {
  const { messageKey, newState } = await ratchetAdvanceSend(state);
  const ciphertext = await ratchetEncrypt(payload, messageKey);
  return { ciphertext, newState, messageIndex: state.messageIndexSend };
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
 * Decrypt a message using the Double Ratchet state.
 */
export async function decryptWithRatchet(
  ciphertextBase64: string,
  state: DoubleRatchetState,
  targetIndex: number
): Promise<{ plaintext: string; newState: DoubleRatchetState }> {
  // Support out of order delivery (skip keys)
  let currentState = state;

  if (targetIndex < currentState.messageIndexRecv) {
    // Check skipped keys
    const skippedKey = currentState.skippedMessageKeys[targetIndex];
    if (!skippedKey) {
      throw new Error('Message key is no longer available; possible replay or excessive reordering');
    }
    const plaintext = await ratchetDecrypt(ciphertextBase64, skippedKey);
    const newSkipped = { ...currentState.skippedMessageKeys };
    delete newSkipped[targetIndex];
    return { plaintext, newState: { ...currentState, skippedMessageKeys: newSkipped } };
  }

  // Fast-forward ratchet if there are skipped messages
  let newSkippedKeys = { ...currentState.skippedMessageKeys };
  while (currentState.messageIndexRecv < targetIndex) {
    const { messageKey, newState } = await ratchetAdvanceRecv(currentState);
    newSkippedKeys[currentState.messageIndexRecv] = messageKey;
    currentState = newState;
  }
  
  newSkippedKeys = pruneSkippedKeys(newSkippedKeys);

  // Now we are at targetIndex
  const { messageKey, newState } = await ratchetAdvanceRecv(currentState);
  const finalState = { ...newState, skippedMessageKeys: newSkippedKeys };
  const plaintext = await ratchetDecrypt(ciphertextBase64, messageKey);
  
  return { plaintext, newState: finalState };
}
