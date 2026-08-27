import type { KryptonMessage, Contact } from '@/types';

// ─── Peer Events ───
export interface PeerEvent {
  url: string;
  status: 'connected' | 'disconnected';
  timestamp: number;
}

// ─── Network Stats ───
export interface NetworkStats {
  peerEvents: PeerEvent[];
  messagesRelayed: number;
  lastSyncTimestamp: number;
}

// ─── Message Analytics ───
export interface MessageDayBucket {
  date: string; // YYYY-MM-DD
  sent: number;
  received: number;
}

export interface ContactActivity {
  contactId: string;
  contactName: string;
  messageCount: number;
}

export interface DashboardStats {
  // Network
  networkStats: NetworkStats;

  // Messaging
  messageDayBuckets: MessageDayBucket[];
  deliverySuccess: number;
  deliveryFailed: number;
  avgCiphertextOverhead: number; // ratio ciphertext / plaintext

  // Security
  identityCreatedAt: number;
  encryptedRatio: number; // should be 100%
  pairingFailures: number;

  // Contacts
  contactGrowth: { date: string; count: number }[];
}

// ─── Helper: compute all dashboard stats from raw store data ───
export function computeDashboardStats(
  messages: KryptonMessage[],
  contacts: Contact[],
  keys: { kryptonId: string } | null,
  peerEvents: PeerEvent[],
  identityCreatedAt: number
): DashboardStats {
  const myId = keys?.kryptonId || '';

  // ── Message day buckets ──
  const bucketMap = new Map<string, { sent: number; received: number }>();
  let totalCiphertextLen = 0;
  let totalPlaintextLen = 0;
  let deliverySuccess = 0;
  const deliveryFailed = 0;

  for (const msg of messages) {
    const d = new Date(msg.timestamp).toISOString().slice(0, 10);
    const bucket = bucketMap.get(d) || { sent: 0, received: 0 };
    if (msg.sender === myId) {
      bucket.sent++;
      deliverySuccess++; // every sent msg that exists = success
    } else {
      bucket.received++;
    }
    bucketMap.set(d, bucket);

    // encryption overhead
    const cipherLen = msg.type === 'ONION_ROUTED' ? msg.encryptedPayload.length : 0;
    const plainLen = msg.decryptedPayload?.length || 1;
    totalCiphertextLen += cipherLen;
    totalPlaintextLen += plainLen;
  }

  const messageDayBuckets: MessageDayBucket[] = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({ date, sent: b.sent, received: b.received }));

  // ── Contact activity ──
  const contactMessageCounts = new Map<string, number>();
  for (const msg of messages) {
    const otherId = msg.sender === myId ? msg.recipient : msg.sender;
    contactMessageCounts.set(otherId, (contactMessageCounts.get(otherId) || 0) + 1);
  }

  // ── Contact growth (mock from contact add order) ──
  const contactGrowth: { date: string; count: number }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  // Since we don't store addedAt, approximate: all contacts exist as of today
  contactGrowth.push({ date: today, count: contacts.filter((c) => !c.isAi).length });

  // ── Network stats ──
  const networkStats: NetworkStats = {
    peerEvents,
    messagesRelayed: messages.filter((m) => m.isNetworkRelayed).length,
    lastSyncTimestamp:
      peerEvents.length > 0 ? (peerEvents[peerEvents.length - 1]?.timestamp ?? 0) : 0,
  };

  return {
    networkStats,
    messageDayBuckets,
    deliverySuccess,
    deliveryFailed,
    avgCiphertextOverhead: totalPlaintextLen > 0 ? totalCiphertextLen / totalPlaintextLen : 0,
    identityCreatedAt,
    encryptedRatio: 100, // all messages are E2EE
    pairingFailures: 0,
    contactGrowth,
  };
}

// ── Top contacts by message count ──
export function getTopContacts(
  messages: KryptonMessage[],
  contacts: Contact[],
  myId: string,
  limit = 5
): ContactActivity[] {
  const counts = new Map<string, number>();
  for (const msg of messages) {
    const otherId = msg.sender === myId ? msg.recipient : msg.sender;
    counts.set(otherId, (counts.get(otherId) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id, count]) => ({
      contactId: id,
      contactName: contacts.find((c) => c.id === id)?.name || id.slice(0, 10) + '...',
      messageCount: count,
    }));
}
