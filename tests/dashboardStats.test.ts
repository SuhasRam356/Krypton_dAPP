import { describe, expect, it } from 'vitest';
import { computeDashboardStats, getTopContacts } from '../src/store/dashboardStats';
import type { Contact, KryptonMessage } from '../src/types';

const myId = `05${'a'.repeat(64)}`;
const aliceId = `05${'b'.repeat(64)}`;

const contacts: Contact[] = [{ id: aliceId, name: 'Alice' }];

const messages: KryptonMessage[] = [
  {
    id: '1',
    timestamp: Date.UTC(2026, 7, 27),
    sender: myId,
    recipient: aliceId,
    type: 'ONION_ROUTED',
    encryptedPayload: 'encrypted-payload-one',
    decryptedPayload: 'hello',
    metadataStripped: true,
    routePath: ['p2p-relay'],
    isNetworkRelayed: true,
  },
  {
    id: '2',
    timestamp: Date.UTC(2026, 7, 27),
    sender: aliceId,
    recipient: myId,
    type: 'ONION_ROUTED',
    encryptedPayload: 'encrypted-payload-two',
    decryptedPayload: 'hi',
    metadataStripped: true,
    routePath: ['p2p-relay'],
    isNetworkRelayed: true,
  },
];

describe('dashboard stats', () => {
  it('computes message buckets and top contacts', () => {
    const stats = computeDashboardStats(
      messages,
      contacts,
      { kryptonId: myId },
      [],
      Date.UTC(2026, 7, 1)
    );

    expect(stats.messageDayBuckets).toEqual([{ date: '2026-08-27', sent: 1, received: 1 }]);
    expect(stats.deliverySuccess).toBe(1);
    expect(stats.encryptedRatio).toBe(100);

    expect(getTopContacts(messages, contacts, myId)).toEqual([
      { contactId: aliceId, contactName: 'Alice', messageCount: 2 },
    ]);
  });
});
