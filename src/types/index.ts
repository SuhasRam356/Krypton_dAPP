import { z } from 'zod';

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export type Address = string; // e.g., 0x...

export interface Contact {
  id: string; // The Krypton ID — "05" + hex(Curve25519 pubkey). Doubles as their encryption key, so there's nothing else to pair.
  name: string;
  isAi?: boolean;
  avatarColor?: string;
  linkedWallet?: string; // Optional ETH address, only used for in-chat crypto transfers.
}

// ── Encrypted Envelopes ──

export interface InnerEnvelope {
  type: 'ONION_ROUTED' | 'UNSEND';
  id: string;                // Message ID
  sender: string;            // Sender Krypton ID
  recipient: string;         // Recipient Krypton ID
  timestamp: number;
  payload: string;           // Message text or target messageId (for UNSEND)
  ratchetIndex?: number;
  isCryptoTransfer?: boolean;
  transferAmount?: number;
  transferSymbol?: string;
  selfDestructTTL?: number;
}

export interface OuterEnvelope {
  sender: string;            // Used to lookup the correct ratchet
  recipient: string;         // Gun routing handles this, but explicit is fine
  encryptedPayload: string;  // The encrypted JSON of the InnerEnvelope
  ratchetIndex?: number;     // Needed to decrypt if using ratchet
}


export type BaseMessage = {
  id: string;
  timestamp: number;
  sender: string; // Krypton ID of sender
  recipient: string; // Krypton ID of recipient
  decryptedPayload?: string; // UI demonstration
  isCryptoTransfer?: boolean;
  transferAmount?: number;
  transferSymbol?: string;
  isNetworkRelayed?: boolean;

  // ── Unsend / Self-Destruct ──
  selfDestructTTL?: number;    // Seconds after reading before auto-delete (e.g. 30, 60, 300)
  selfDestructAt?: number;     // Computed: timestamp when this message should auto-delete
  isDeleted?: boolean;         // Tombstone — sender unsent this message
  deletedAt?: number;          // When it was unsent

  // ── Forward Secrecy (Phase 3) ──
  ratchetIndex?: number;       // Which ratchet step this message was encrypted under
};

// Discriminated union for message types
export type OnionRoutedMessage = BaseMessage & {
  type: 'ONION_ROUTED';
  encryptedPayload: string;
  metadataStripped: true;
  routePath: string[]; // Mocking session's onion route path
};

export type OnChainMessage = BaseMessage & {
  type: 'ON_CHAIN';
  txHash: string;
  blockNumber: number;
  payload: string; // From Adamant
};

export type KryptonMessage = OnionRoutedMessage | OnChainMessage;

// ── Control messages (not displayed in chat, used for signaling) ──
export type ControlMessage = {
  type: 'UNSEND';
  messageId: string;         // The ID of the message to tombstone
  sender: string;
  timestamp: number;
};

export const WalletAssetSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  balance: z.number(),
  decimals: z.number(),
  contractAddress: AddressSchema.optional(),
});

export type WalletAsset = z.infer<typeof WalletAssetSchema>;

export type WalletState = {
  address: Address;
  assets: WalletAsset[];
  network: 'Mainnet' | 'Testnet' | 'Sepolia';
};
