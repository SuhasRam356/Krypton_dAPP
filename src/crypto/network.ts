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

// Tracks the currently-active inbox subscription so we can unsubscribe cleanly
// before resubscribing under a new identity (avoids duplicate listeners / leaks).
let activeInboxMap: GunMapChain | null = null;

/**
 * Subscribe to messages sent to this user's Krypton ID.
 * This acts as the "Inbox" node for a given identity.
 */
export const subscribeToInbox = (
  kryptonId: string,
  onMessageReceived: (message: NetworkPayload) => void,
  onLegacyControlMessage?: (ctrl: ControlMessage) => void
) => {
  const gun = getGun();

  if (activeInboxMap) {
    activeInboxMap.off();
    activeInboxMap = null;
  }

  const inboxMap = gun.get(`krypton_inbox_${kryptonId}`).map();
  activeInboxMap = inboxMap;

  inboxMap.on((data) => {
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
  });

  return () => {
    inboxMap.off();
    if (activeInboxMap === inboxMap) {
      activeInboxMap = null;
    }
  };
};

/**
 * Send an encrypted payload to a recipient's inbox, keyed by their Krypton ID.
 * Returns true if a relay connection is currently known, false if the caller should queue.
 */
export const sendToNetwork = (
  recipientKryptonId: string,
  encryptedPayload: NetworkPayload
): boolean => {
  const gun = getGun();
  const inboxNode = gun.get(`krypton_inbox_${recipientKryptonId}`);

  // Gun.js does not support nested arrays natively. We stringify the payload.
  inboxNode.set({ payloadStr: JSON.stringify(encryptedPayload) });
  return relayConnected;
};
