import { describe, expect, it } from 'vitest';
import {
  deriveKryptonIdentityFromMnemonic,
  fromHex,
  generateKryptonIdentity,
  isValidKryptonId,
} from '../src/crypto/keys';
import {
  decryptFromContact,
  decryptWithRatchetDemo,
  encryptForContact,
  encryptWithRatchetDemo,
  initContactRatchet,
} from '../src/crypto/encryption';
import { decryptVault, deriveKeyFromPin, encryptVault, generateSalt } from '../src/crypto/vault';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('Krypton identity', () => {
  it('restores the same identity from the same mnemonic', () => {
    const first = deriveKryptonIdentityFromMnemonic(TEST_MNEMONIC, 1000);
    const second = deriveKryptonIdentityFromMnemonic(TEST_MNEMONIC, 2000);

    expect(first.kryptonId).toBe(second.kryptonId);
    expect(first.ethAddress).toBe(second.ethAddress);
    expect(isValidKryptonId(first.kryptonId)).toBe(true);
  });

  it('rejects invalid Krypton IDs', () => {
    expect(isValidKryptonId('05not-a-real-key')).toBe(false);
    expect(() => fromHex('05not-a-real-key')).toThrow(/Invalid Krypton ID/);
  });
});

describe('authenticated encryption', () => {
  it('round-trips a message for a contact and rejects the wrong sender key', async () => {
    const alice = generateKryptonIdentity();
    const bob = generateKryptonIdentity();
    const mallory = generateKryptonIdentity();

    const ciphertext = await encryptForContact(
      'hello bob',
      alice.messagingPrivateKey,
      bob.messagingPublicKey
    );
    await expect(
      decryptFromContact(ciphertext, bob.messagingPrivateKey, alice.messagingPublicKey)
    ).resolves.toBe('hello bob');
    await expect(
      decryptFromContact(ciphertext, bob.messagingPrivateKey, mallory.messagingPublicKey)
    ).rejects.toThrow();
  });

  it('supports bounded out-of-order ratchet delivery', async () => {
    const alice = generateKryptonIdentity();
    const bob = generateKryptonIdentity();

    const alicePair = await initContactRatchet(
      alice.messagingPrivateKey,
      bob.messagingPublicKey,
      alice.kryptonId,
      bob.kryptonId
    );
    const bobPair = await initContactRatchet(
      bob.messagingPrivateKey,
      alice.messagingPublicKey,
      bob.kryptonId,
      alice.kryptonId
    );

    const first = await encryptWithRatchetDemo('first', alicePair.send);
    const second = await encryptWithRatchetDemo('second', first.newState);

    const decryptedSecond = await decryptWithRatchetDemo(
      second.ciphertext,
      bobPair.recv,
      second.ratchetIndex
    );
    expect(decryptedSecond.plaintext).toBe('second');

    const decryptedFirst = await decryptWithRatchetDemo(
      first.ciphertext,
      decryptedSecond.newState,
      first.ratchetIndex
    );
    expect(decryptedFirst.plaintext).toBe('first');
  });
});

describe('encrypted vault', () => {
  it('decrypts with the correct PIN-derived key and rejects a wrong key', async () => {
    const salt = await generateSalt();
    const correctKey = await deriveKeyFromPin('1234', salt);
    const wrongKey = await deriveKeyFromPin('9999', salt);

    const encrypted = await encryptVault('secret payload', correctKey);
    await expect(decryptVault(encrypted, correctKey)).resolves.toBe('secret payload');
    await expect(decryptVault(encrypted, wrongKey)).rejects.toThrow();
  });
});
