import { z } from 'zod';

export const KryptonIdSchema = z.string().regex(/^05[a-fA-F0-9]{64}$/);
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export type Address = string; // e.g., 0x...
export type KryptonId = string; // Session-style 05 + hex(Curve25519 public key)

export interface Contact {
  id: string; // Real contacts use KryptonId; the built-in AI assistant uses an internal pseudo-id.
  name: string;
  isAi?: boolean;
  avatarColor?: string;
  linkedWallet?: Address; // Optional ETH address, only used for in-chat crypto transfer notes.
  addedAt?: number;
}

export type BaseMessage = {
  id: string;
  timestamp: number;
  sender: string; // Krypton ID of sender, or an internal pseudo-id for local-only assistant messages
  recipient: string; // Krypton ID of recipient, or an internal pseudo-id for local-only assistant messages
  decryptedPayload?: string; // UI-only plaintext preview, persisted inside the encrypted vault.
  isCryptoTransfer?: boolean;
  transferAmount?: number;
  transferSymbol?: string;
  isNetworkRelayed?: boolean;

  // ── Unsend / Self-Destruct ──
  selfDestructTTL?: number; // Seconds after reading before auto-delete (e.g. 30, 60, 300)
  selfDestructAt?: number; // Computed: timestamp when this message should auto-delete
  isDeleted?: boolean; // Tombstone — sender unsent this message
  deletedAt?: number; // When it was unsent

  // ── Forward Secrecy Demo Ratchet ──
  ratchetIndex?: number; // Which ratchet step this message was encrypted under
  initializationPayload?: {
    ephemeralPublicKey: string; // hex
    kyberCiphertext?: string; // hex
  };

  // ── Encrypted File Attachments ──
  attachment?: {
    data: string; // Base64 Data URL
    filename: string;
    mimeType: string;
    size: number;
  };
};

// Discriminated union for message types
export type OnionRoutedMessage = BaseMessage & {
  type: 'ONION_ROUTED';
  encryptedPayload: string;
  metadataStripped: true;
  routePath: string[]; // Demo route path; not production onion routing.
};

export type OnChainMessage = BaseMessage & {
  type: 'ON_CHAIN';
  txHash: string;
  blockNumber: number;
  payload: string; // From Adamant-inspired transaction memo
};

export type KryptonMessage = OnionRoutedMessage | OnChainMessage;

export type MessageEnvelope = {
  version: 1;
  id: string;
  timestamp: number;
  sender: KryptonId;
  recipient: KryptonId;
  body: string;
  isCryptoTransfer?: boolean;
  transferAmount?: number;
  transferSymbol?: string;
  selfDestructTTL?: number;
  attachment?: {
    data: string;
    filename: string;
    mimeType: string;
    size: number;
  };
  initializationPayload?: {
    ephemeralPublicKey: string; // hex
    kyberCiphertext?: string; // hex
  };
};

// ── Control messages (encrypted on the wire, not displayed in chat) ──
export type ControlMessage = {
  version: 1;
  type: 'UNSEND';
  messageId: string;
  sender: KryptonId;
  recipient: KryptonId;
  timestamp: number;
};

export type EncryptedControlMessage = {
  id: string;
  timestamp: number;
  sender: KryptonId;
  recipient: KryptonId;
  type: 'CONTROL';
  encryptedPayload: string;
  isNetworkRelayed?: boolean;
};

export type NetworkPayload =
  Partial<OnionRoutedMessage> | Partial<EncryptedControlMessage> | Partial<ControlMessage>;

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
