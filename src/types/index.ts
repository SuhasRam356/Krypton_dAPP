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
  network: 'Mainnet' | 'Testnet';
};
