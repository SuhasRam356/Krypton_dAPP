import Gun from 'gun';
import type { PeerEvent } from '@/store/dashboardStats';

// TODO: replace with your self-hosted relay (radisk: true) as PEERS[0] for store-and-forward.
// e.g. 'https://your-relay.onrender.com/gun'
const PEERS = [
  'http://localhost:8765/gun'
];

let gunInstance: any = null;

// Peer event listeners — the store/dashboard subscribes to these
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

export const getGun = () => {
  if (!gunInstance) {
    gunInstance = Gun({
      peers: PEERS,
      localStorage: false, // We handle our own persistence via Zustand
      radisk: false
    });
    gunInstance.on('hi', (peer: any) => {
      const url = peer?.url || peer || 'unknown';
      console.log('[gun] connected to peer', url);
      const evt: PeerEvent = { url, status: 'connected', timestamp: Date.now() };
      peerEventListeners.forEach(cb => cb(evt));
    });
    gunInstance.on('bye', (peer: any) => {
      const url = peer?.url || peer || 'unknown';
      console.log('[gun] disconnected from peer', url);
      const evt: PeerEvent = { url, status: 'disconnected', timestamp: Date.now() };
      peerEventListeners.forEach(cb => cb(evt));
    });
  }
  return gunInstance;
};

// Tracks the currently-active inbox subscription so we can unsubscribe cleanly
// before resubscribing under a new identity (avoids duplicate listeners / leaks).
let activeInboxNode: any = null;

/**
 * Subscribe to messages sent to this user's Krypton ID.
 * This acts as the "Inbox" node for a given identity.
 */
export const subscribeToInbox = (
  kryptonId: string,
  onMessageReceived: (message: any) => void
) => {
  const gun = getGun();

  if (activeInboxNode) {
    activeInboxNode.map().off();
    activeInboxNode = null;
  }

  const inboxNode = gun.get(`krypton_inbox_${kryptonId}`);
  activeInboxNode = inboxNode;

  inboxNode.map().on((data: any, id: string) => {
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
 */
export const sendToNetwork = (recipientKryptonId: string, encryptedPayload: any) => {
  const gun = getGun();
  const inboxNode = gun.get(`krypton_inbox_${recipientKryptonId}`);

  // Gun.js does not support nested arrays natively. We must stringify the payload.
  inboxNode.set({ payloadStr: JSON.stringify(encryptedPayload) });
};
