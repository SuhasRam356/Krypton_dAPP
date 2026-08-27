import Gun from 'gun';
import type { PeerEvent } from '@/store/dashboardStats';

const envPeers = process.env.NEXT_PUBLIC_GUN_PEERS;
const PEERS = envPeers ? envPeers.split(',') : ['http://localhost:8765/gun'];

let gunInstance: ReturnType<typeof Gun> | null = null;

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

export const getPeers = () => PEERS;

// ── Relay connectivity tracking ──
let _isRelayConnected = false;
type ConnectivityCallback = (connected: boolean) => void;
const connectivityListeners: ConnectivityCallback[] = [];

export const isRelayConnected = () => _isRelayConnected;

export const onConnectivityChange = (cb: ConnectivityCallback) => {
  connectivityListeners.push(cb);
  return () => {
    const idx = connectivityListeners.indexOf(cb);
    if (idx >= 0) connectivityListeners.splice(idx, 1);
  };
};

export const getGun = () => {
  if (!gunInstance) {
    gunInstance = Gun({
      peers: PEERS,
      localStorage: false, // We handle our own persistence via Zustand
      radisk: false
    });
    gunInstance.on('hi', (peer: { url?: string } | string) => {
      const url = (typeof peer === 'object' ? peer?.url : peer) || 'unknown';
      console.log('[gun] connected to peer', url);
      _isRelayConnected = true;
      connectivityListeners.forEach(cb => cb(true));
      const evt: PeerEvent = { url, status: 'connected', timestamp: Date.now() };
      peerEventListeners.forEach(cb => cb(evt));
    });
    gunInstance.on('bye', (peer: { url?: string } | string) => {
      const url = (typeof peer === 'object' ? peer?.url : peer) || 'unknown';
      console.log('[gun] disconnected from peer', url);
      _isRelayConnected = false;
      connectivityListeners.forEach(cb => cb(false));
      const evt: PeerEvent = { url, status: 'disconnected', timestamp: Date.now() };
      peerEventListeners.forEach(cb => cb(evt));
    });
  }
  return gunInstance;
};

// Tracks the currently-active inbox subscription so we can unsubscribe cleanly
// before resubscribing under a new identity (avoids duplicate listeners / leaks).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeInboxNode: any = null;

/**
 * Subscribe to messages sent to this user's Krypton ID.
 * This acts as the "Inbox" node for a given identity.
 * Now also handles control messages (UNSEND signals).
 */
export const subscribeToInbox = (
  kryptonId: string,
  onMessageReceived: (message: Record<string, unknown>) => void
) => {
  const gun = getGun();

  if (activeInboxNode) {
    activeInboxNode.map().off();
    activeInboxNode = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inboxNode: any = gun.get(`krypton_inbox_${kryptonId}`);
  activeInboxNode = inboxNode;

  inboxNode.map().on((data: { payloadStr?: string; id?: string }) => {
    if (data && data.payloadStr) {
      try {
        const msg = JSON.parse(data.payloadStr);
        onMessageReceived(msg);
      } catch (e) {
        console.error("Failed to parse incoming Gun.js message", e);
      }
    } else if (data && data.id) {
      // Fallback for older messages
      onMessageReceived(data);
    }
  });
};

/**
 * Send an encrypted payload to a recipient's inbox, keyed by their Krypton ID.
 * Returns true if sent, false if relay is offline (caller should queue).
 */
export const sendToNetwork = (recipientKryptonId: string, encryptedPayload: Record<string, unknown>): boolean => {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inboxNode: any = gun.get(`krypton_inbox_${recipientKryptonId}`);

  // Gun.js does not support nested arrays natively. We must stringify the payload.
  inboxNode.set({ payloadStr: JSON.stringify(encryptedPayload) });
  return _isRelayConnected;
};



