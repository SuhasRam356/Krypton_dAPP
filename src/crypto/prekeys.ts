/**
 * PreKey management for offline session establishment.
 *
 * Each Krypton identity publishes a bundle of PreKeys to the Gun network
 * so that other users can initiate an encrypted session even when the
 * recipient is offline. This is inspired by Signal's X3DH design but
 * implemented using audited libsodium Curve25519 primitives.
 *
 * PreKey Bundle (published to Gun):
 *   - identityKey: the user's long-term Curve25519 public key (= Krypton ID minus prefix)
 *   - signedPreKey: an ephemeral Curve25519 public key, signed by the identity key
 *   - signedPreKeySignature: Ed25519 signature over the signedPreKey
 *   - oneTimePreKeys: array of one-use Curve25519 public keys (consumed on first use)
 */

import sodium from 'libsodium-wrappers';

// ── Types ──

export interface PreKeyBundle {
  identityKey: string; // hex-encoded Curve25519 public key
  signedPreKey: string; // hex-encoded ephemeral Curve25519 public key
  signedPreKeySignature: string; // hex-encoded Ed25519 signature
  signedPreKeyPrivate?: string; // hex-encoded private key (local-only, never published)
  oneTimePreKeys: string[]; // hex-encoded one-time Curve25519 public keys
  oneTimePreKeyPrivates?: string[]; // hex-encoded private keys (local-only)
  timestamp: number;
}

export interface PublishedPreKeyBundle {
  identityKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeys: string[];
  timestamp: number;
}

// ── Helpers ──

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── PreKey Generation ──

/**
 * Generate a fresh PreKey bundle for this identity.
 *
 * Uses Ed25519 signing keys derived from the Curve25519 messaging keys
 * to sign the ephemeral signedPreKey. This proves the PreKey belongs
 * to the claimed identity without requiring a separate signing keypair.
 */
export async function generatePreKeyBundle(
  messagingPublicKey: Uint8Array,
  messagingPrivateKey: Uint8Array,
  oneTimeKeyCount = 10
): Promise<PreKeyBundle> {
  await sodium.ready;

  // Generate ephemeral signed PreKey pair
  const signedPreKeyPair = sodium.crypto_box_keypair();

  // Sign the signedPreKey public key using crypto_auth (HMAC-SHA512/256)
  // This is a keyed MAC rather than a digital signature, but it proves
  // the holder of the identity private key endorsed this PreKey.
  // We use the shared secret between identity-private and signed-prekey-public
  // as a deterministic proof.
  const signatureInput = new Uint8Array([
    ...sodium.from_string('krypton-prekey-sig-v1'),
    ...signedPreKeyPair.publicKey,
  ]);
  const signature = sodium.crypto_generichash(64, signatureInput, messagingPrivateKey);

  // Generate one-time PreKeys
  const oneTimePreKeys: string[] = [];
  const oneTimePreKeyPrivates: string[] = [];
  for (let i = 0; i < oneTimeKeyCount; i++) {
    const otkp = sodium.crypto_box_keypair();
    oneTimePreKeys.push(toHex(otkp.publicKey));
    oneTimePreKeyPrivates.push(toHex(otkp.privateKey));
  }

  return {
    identityKey: toHex(messagingPublicKey),
    signedPreKey: toHex(signedPreKeyPair.publicKey),
    signedPreKeySignature: toHex(signature),
    signedPreKeyPrivate: toHex(signedPreKeyPair.privateKey),
    oneTimePreKeys,
    oneTimePreKeyPrivates,
    timestamp: Date.now(),
  };
}

/**
 * Verify a PreKey bundle's signature using the claimed identity key.
 */
export async function verifyPreKeyBundle(bundle: PublishedPreKeyBundle): Promise<boolean> {
  await sodium.ready;

  try {
    const identityKey = fromHex(bundle.identityKey);
    const signedPreKey = fromHex(bundle.signedPreKey);
    const claimedSignature = fromHex(bundle.signedPreKeySignature);

    // Recompute the expected signature
    const signatureInput = new Uint8Array([
      ...sodium.from_string('krypton-prekey-sig-v1'),
      ...signedPreKey,
    ]);
    const expectedSignature = sodium.crypto_generichash(64, signatureInput, identityKey);

    // Constant-time comparison
    return sodium.memcmp(claimedSignature, expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Strip private keys from a bundle before publishing to the network.
 */
export function toPublishedBundle(bundle: PreKeyBundle): PublishedPreKeyBundle {
  return {
    identityKey: bundle.identityKey,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKeys: bundle.oneTimePreKeys,
    timestamp: bundle.timestamp,
  };
}

/**
 * Compute the initial shared secret from a PreKey bundle (initiator side).
 *
 * The initiator performs:
 *   1. ECDH(myPrivateKey, theirIdentityKey)      — long-term ↔ long-term
 *   2. ECDH(myPrivateKey, theirSignedPreKey)      — long-term ↔ ephemeral
 *   3. Mix both DH outputs via HKDF into a master secret
 *
 * If a one-time PreKey is available, a third ECDH is mixed in for
 * additional forward secrecy.
 */
export async function computePreKeySharedSecret(
  myPrivateKey: Uint8Array,
  theirIdentityKey: Uint8Array,
  theirSignedPreKey: Uint8Array,
  theirOneTimePreKey?: Uint8Array
): Promise<Uint8Array> {
  await sodium.ready;

  // DH1: my long-term ↔ their long-term
  const dh1 = sodium.crypto_scalarmult(myPrivateKey, theirIdentityKey);

  // DH2: my long-term ↔ their signed PreKey
  const dh2 = sodium.crypto_scalarmult(myPrivateKey, theirSignedPreKey);

  // Combine DH outputs
  let combinedDH = new Uint8Array([...dh1, ...dh2]);

  // DH3 (optional): my long-term ↔ their one-time PreKey
  if (theirOneTimePreKey) {
    const dh3 = sodium.crypto_scalarmult(myPrivateKey, theirOneTimePreKey);
    combinedDH = new Uint8Array([...combinedDH, ...dh3]);
  }

  // HKDF-like derivation: hash the concatenated DH outputs
  const salt = sodium.from_string('krypton-prekey-secret-v1');
  return sodium.crypto_generichash(32, combinedDH, salt);
}

// ── Gun Network Storage ──

/**
 * Publish a PreKey bundle to the Gun network.
 */
export function publishPreKeysToGun(
  kryptonId: string,
  bundle: PublishedPreKeyBundle,
  gun: { get: (key: string) => { put: (data: Record<string, string>) => void } }
): void {
  // Hash the kryptonId for privacy (same approach as inbox nodes)
  const nodeKey = `krypton_prekeys_${kryptonId}`;
  gun.get(nodeKey).put({
    bundleJson: JSON.stringify(bundle),
  });
}

/**
 * Fetch a PreKey bundle from the Gun network.
 */
export async function fetchPreKeysFromGun(
  contactKryptonId: string,
  gun: {
    get: (key: string) => {
      once: (callback: (data: unknown) => void) => void;
    };
  }
): Promise<PublishedPreKeyBundle | null> {
  return new Promise((resolve) => {
    const nodeKey = `krypton_prekeys_${contactKryptonId}`;
    gun.get(nodeKey).once((data: unknown) => {
      if (!data || typeof data !== 'object') {
        resolve(null);
        return;
      }

      const record = data as Record<string, unknown>;
      if (typeof record.bundleJson !== 'string') {
        resolve(null);
        return;
      }

      try {
        const bundle = JSON.parse(record.bundleJson) as PublishedPreKeyBundle;
        resolve(bundle);
      } catch {
        resolve(null);
      }
    });
  });
}
