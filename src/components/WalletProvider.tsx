'use client';

/**
 * Compatibility shim: exposes the same `useWeb3()` hook API that
 * WalletDashboard and other consumers expect, but delegates all
 * wallet operations to Wagmi hooks under the hood.
 *
 * This file no longer creates its own React context — it simply
 * re-exports a hook. The `WalletProvider` component is kept as a
 * pass-through so layout.tsx doesn't need to change its JSX tree
 * beyond wrapping with Web3Provider.
 */

import { type ReactNode, useCallback } from 'react';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from 'wagmi';
import { injected } from 'wagmi/connectors';
import { sepolia } from 'wagmi/chains';
import { useKryptonStore } from '@/store/useKryptonStore';

interface TransactionResult {
  txHash: string;
  blockNumber: number;
}

interface Web3ContextType {
  provider: unknown;
  signer: unknown;
  address: string | null;
  chainId: bigint | null;
  networkName: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnecting: boolean;
  error: string | null;
  sendTransaction: (to: string, amountEth: string) => Promise<TransactionResult>;
  switchToSepolia: () => Promise<void>;
}

const CHAIN_NAMES: Record<string, string> = {
  '1': 'Mainnet',
  '11155111': 'Sepolia',
  '5': 'Goerli',
  '137': 'Polygon',
  '80001': 'Mumbai',
  '42161': 'Arbitrum',
  '10': 'Optimism',
};

/**
 * Drop-in replacement for the old useWeb3() hook.
 * Consumers don't need to change — same return shape.
 */
export function useWeb3(): Web3ContextType {
  const { address, chainId, isConnecting: wagmiConnecting, connector } = useAccount();
  const { connectAsync, error: connectError } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { linkWallet } = useKryptonStore();

  const networkName = chainId
    ? (CHAIN_NAMES[chainId.toString()] ?? `Chain ${chainId}`)
    : 'Not Connected';

  const connect = useCallback(async () => {
    const result = await connectAsync({ connector: injected() });
    const connectedAddress = result.accounts[0];
    if (connectedAddress) {
      linkWallet(connectedAddress);
    }
  }, [connectAsync, linkWallet]);

  const disconnect = useCallback(() => {
    wagmiDisconnect();
  }, [wagmiDisconnect]);

  const switchToSepolia = useCallback(async () => {
    await switchChainAsync?.({ chainId: sepolia.id });
  }, [switchChainAsync]);

  // For on-chain transactions, we still use ethers under the hood since
  // Wagmi's useSendTransaction hook is designed for React rendering, not
  // imperative calls from inside event handlers. This keeps the existing
  // WalletDashboard transaction flow working without a major rewrite.
  const sendTransaction = useCallback(
    async (to: string, amountEth: string): Promise<TransactionResult> => {
      if (!connector) throw new Error('Wallet not connected');

      const { ethers } = await import('ethers');
      if (!ethers.isAddress(to)) throw new Error('Invalid recipient address');

      const parsedAmount = Number(amountEth);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Amount must be greater than zero');
      }

      const walletProvider = await connector.getProvider();
      const browserProvider = new ethers.BrowserProvider(
        walletProvider as ConstructorParameters<typeof ethers.BrowserProvider>[0]
      );
      const signer = await browserProvider.getSigner();

      const tx = await signer.sendTransaction({
        to,
        value: ethers.parseEther(amountEth),
      });

      const receipt = await tx.wait(1);
      if (!receipt) throw new Error('Transaction failed — no receipt');

      return {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      };
    },
    [connector]
  );

  return {
    provider: connector ?? null,
    signer: connector ?? null,
    address: address ?? null,
    chainId: chainId ? BigInt(chainId) : null,
    networkName,
    connect,
    disconnect,
    isConnecting: wagmiConnecting,
    error: connectError?.message ?? null,
    sendTransaction,
    switchToSepolia,
  };
}

/**
 * Pass-through wrapper kept for layout.tsx compatibility.
 * The real provider is Web3Provider (Wagmi + React Query).
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
