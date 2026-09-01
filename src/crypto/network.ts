import Gun from 'gun';
import type { PeerEvent } from '@/store/dashboardStats';
import type { ControlMessage, NetworkPayload } from '@/types';

type GunPeer = string | { url?: string };
type GunMapChain = {
  on: (callback: (data: unknown, id: string) => void) => void;
  off: () => void;
};
type GunChain = {
  get: (key: string) => GunChain;
  set: (data: Record<string, string>) => void;
  map: () => GunMapChain;
};
type GunInstance = GunChain & {
  on: (event: 'hi' | 'bye', callback: (peer: GunPeer) => void) => void;
};
type GunFactory = (options: {
  peers: string[];
  localStorage: boolean;
  radisk: boolean;
}) => GunInstance;

const GUN_RELAY_PORT = '8765';
const DEFAULT_LOCAL_PEER = `http://localhost:${GUN_RELAY_PORT}/gun`;

let resolvedPeers: string[] | null = null;
let gunInstance: GunInstance | null = null;

function resolvePeers(): string[] {
  const configuredPeers = process.env.NEXT_PUBLIC_GUN_PEERS?.split(',')
    .map((peer) => peer.trim())
    .filter(Boolean);

  if (configuredPeers?.length) {
    return configuredPeers;
  }

  if (typeof window !== 'undefined') {
    const { protocol, host } = window.location;
    if (/^\d+-.*\.e2b\.app$/i.test(host)) {
      return [`${protocol}//${host.replace(/^\d+-/, `${GUN_RELAY_PORT}-`)}/gun`];
    }
  }

  return [DEFAULT_LOCAL_PEER];
}

function getPeerUrl(peer: GunPeer): string {
  if (typeof peer === 'string') return peer;
  return peer.url ?? 'unknown';
}

// ── Peer event listeners — the store/dashboard subscribes to these ──
type PeerEventCallback = (event: PeerEvent) => void;
const peerEventListeners: PeerEventCallback[] = [];

export const onPeerEvent = (cb: PeerEventCallback) => {
  peerEventListeners.push(cb);
  return () => {
    const idx = peerEventListeners.indexOf(cb);
    if (idx >= 0) peerEventListeners.splice(idx, 1);
  };
};

export const getPeers = () => {
  resolvedPeers ??= resolvePeers();
  return resolvedPeers;
};

// ── Relay connectivity tracking ──
let relayConnected = false;
type ConnectivityCallback = (connected: boolean) => void;
const connectivityListeners: ConnectivityCallback[] = [];

export const isRelayConnected = () => relayConnected;

export const onConnectivityChange = (cb: ConnectivityCallback) => {
  connectivityListeners.push(cb);
  return () => {
    const idx = connectivityListeners.indexOf(cb);
    if (idx >= 0) connectivityListeners.splice(idx, 1);
  };
};

function emitConnectivity(connected: boolean, peer: GunPeer) {
  const url = getPeerUrl(peer);
  relayConnected = connected;
  connectivityListeners.forEach((cb) => cb(connected));

  const evt: PeerEvent = {
    url,
    status: connected ? 'connected' : 'disconnected',
    timestamp: Date.now(),
  };
  peerEventListeners.forEach((cb) => cb(evt));
}

export const getGun = () => {
  if (!gunInstance) {
    const createGun = Gun as unknown as GunFactory;
    gunInstance = createGun({
      peers: getPeers(),
      localStorage: false, // We handle our own persistence via Zustand
      radisk: false,
    });

    gunInstance.on('hi', (peer) => {
      console.log('[gun] connected to peer', getPeerUrl(peer));
      emitConnectivity(true, peer);
    });

    gunInstance.on('bye', (peer) => {
      console.log('[gun] disconnected from peer', getPeerUrl(peer));
      emitConnectivity(false, peer);
    });
  }
  return gunInstance;
};

// ── Time-Bucketing & Privacy Hashing ──
//
// Instead of storing all messages under a single `krypton_inbox_${id}` node
// (which grows unbounded and will eventually crash the browser / relay),
// we split the inbox into daily buckets:
//
//   krypton_inbox_v2_<SHA256(recipientId)>_<YYYY-MM-DD>
//
// The recipient ID is hashed so passive relay observers cannot read
// plaintext Krypton IDs from the Gun graph keys. Both sender and
// recipient can deterministically compute the same hash because they
// both know the recipient's public Krypton ID.

/**
 * Simple SHA-256 hex hash using the Web Crypto API.
 * Falls back to a basic string hash in non-browser environments (tests).
 */
async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const buffer = new TextEncoder().encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for test environments without SubtleCrypto
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/** Returns today's date as YYYY-MM-DD in UTC. */
function todayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns tomorrow's date as YYYY-MM-DD in UTC. */
function tomorrowBucket(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Returns yesterday's date as YYYY-MM-DD in UTC. */
function yesterdayBucket(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Whether we are within 5 minutes of midnight UTC. */
function isNearMidnight(): boolean {
  const now = new Date();
  const minutesUntilMidnight = (24 * 60) - (now.getUTCHours() * 60 + now.getUTCMinutes());
  return minutesUntilMidnight <= 5 || minutesUntilMidnight >= (24 * 60 - 5);
}

/**
 * Build the Gun node key for a time-bucketed inbox.
 * Format: krypton_inbox_v2_<hashedId>_<date>
 */
async function inboxNodeKey(recipientKryptonId: string, dateBucket: string): Promise<string> {
  const hashedId = await sha256Hex(recipientKryptonId);
  return `krypton_inbox_v2_${hashedId}_${dateBucket}`;
}

// ── Legacy inbox key (for backwards compatibility during migration) ──
function legacyInboxNodeKey(kryptonId: string): string {
  return `krypton_inbox_${kryptonId}`;
}

// Tracks the currently-active inbox subscriptions so we can unsubscribe cleanly
// before resubscribing under a new identity (avoids duplicate listeners / leaks).
let activeInboxMaps: GunMapChain[] = [];

/**
 * Subscribe to messages sent to this user's Krypton ID.
 *
 * Subscribes to multiple time-bucketed nodes (yesterday, today, and
 * near midnight also tomorrow) plus the legacy node for backwards
 * compatibility with older Krypton builds.
 */
export const subscribeToInbox = (
  kryptonId: string,
  onMessageReceived: (message: NetworkPayload) => void,
  onLegacyControlMessage?: (ctrl: ControlMessage) => void
) => {
  const gun = getGun();

  // Tear down previous subscriptions
  for (const map of activeInboxMaps) {
    map.off();
  }
  activeInboxMaps = [];

  const handleGunData = (data: unknown) => {
    if (!data || typeof data !== 'object') return;

    const record = data as Record<string, unknown>;
    if (typeof record.payloadStr === 'string') {
      try {
        const message = JSON.parse(record.payloadStr) as NetworkPayload;
        if (message.type === 'UNSEND' && onLegacyControlMessage) {
          onLegacyControlMessage(message as ControlMessage);
        } else {
          onMessageReceived(message);
        }
      } catch (error) {
        console.error('Failed to parse incoming Gun.js message', error);
      }
      return;
    }

    // Fallback for older messages that were written directly into Gun.
    if (typeof record.id === 'string') {
      onMessageReceived(record as NetworkPayload);
    }
  };

  // Subscribe to legacy inbox (backwards compat)
  const legacyMap = gun.get(legacyInboxNodeKey(kryptonId)).map();
  legacyMap.on(handleGunData);
  activeInboxMaps.push(legacyMap);

  // Subscribe to time-bucketed inboxes (async because of SHA-256)
  void (async () => {
    const buckets = [yesterdayBucket(), todayBucket()];
    if (isNearMidnight()) {
      buckets.push(tomorrowBucket());
    }

    for (const bucket of buckets) {
      const nodeKey = await inboxNodeKey(kryptonId, bucket);
      const bucketMap = gun.get(nodeKey).map();
      bucketMap.on(handleGunData);
      activeInboxMaps.push(bucketMap);
    }
  })();

  // Set up a periodic check to subscribe to the next day's bucket near midnight
  const midnightCheckInterval = setInterval(() => {
    if (isNearMidnight()) {
      void (async () => {
        const tomorrowKey = await inboxNodeKey(kryptonId, tomorrowBucket());
        // Avoid duplicate subscriptions by checking if we already have this key
        const alreadySubscribed = activeInboxMaps.length > 4; // legacy + yesterday + today + tomorrow
        if (!alreadySubscribed) {
          const tomorrowMap = gun.get(tomorrowKey).map();
          tomorrowMap.on(handleGunData);
          activeInboxMaps.push(tomorrowMap);
        }
      })();
    }
  }, 60_000); // Check every minute

  return () => {
    clearInterval(midnightCheckInterval);
    for (const map of activeInboxMaps) {
      map.off();
    }
    activeInboxMaps = [];
  };
};

/**
 * Send an encrypted payload to a recipient's inbox, keyed by their Krypton ID.
 * Returns true if a relay connection is currently known, false if the caller should queue.
 *
 * Messages are written to today's time-bucketed node AND the legacy node
 * (for backwards compatibility with older clients).
 */
export const sendToNetwork = (
  recipientKryptonId: string,
  encryptedPayload: NetworkPayload
): boolean => {
  const gun = getGun();
  const payloadStr = JSON.stringify(encryptedPayload);

  // Write to legacy inbox (backwards compat)
  gun.get(legacyInboxNodeKey(recipientKryptonId)).set({ payloadStr });

  // Write to today's time-bucketed inbox (async because of SHA-256)
  void (async () => {
    const nodeKey = await inboxNodeKey(recipientKryptonId, todayBucket());
    gun.get(nodeKey).set({ payloadStr });
  })();

  return relayConnected;
};
