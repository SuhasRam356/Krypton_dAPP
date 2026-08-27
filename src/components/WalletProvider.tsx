'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { useKryptonStore } from '@/store/useKryptonStore';

interface TransactionResult {
  txHash: string;
  blockNumber: number;
}

interface Web3ContextType {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
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

type EthereumEventHandler = ((accounts: string[]) => void) | ((chainIdHex: string) => void);

type EthereumProvider = ethers.Eip1193Provider & {
  on?: (event: 'accountsChanged' | 'chainChanged', handler: EthereumEventHandler) => void;
  removeListener?: (
    event: 'accountsChanged' | 'chainChanged',
    handler: EthereumEventHandler
  ) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const Web3Context = createContext<Web3ContextType | null>(null);

// Chain ID → friendly name mapping
const CHAIN_NAMES: Record<string, string> = {
  '1': 'Mainnet',
  '11155111': 'Sepolia',
  '5': 'Goerli',
  '137': 'Polygon',
  '80001': 'Mumbai',
  '42161': 'Arbitrum',
  '10': 'Optimism',
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown wallet error';
}

function getProviderErrorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

function getInjectedProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return window.ethereum ?? null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider] = useState<ethers.BrowserProvider | null>(() => {
    const injected = getInjectedProvider();
    return injected ? new ethers.BrowserProvider(injected) : null;
  });
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { linkWallet } = useKryptonStore();

  const networkName = useMemo(
    () => (chainId ? (CHAIN_NAMES[chainId.toString()] ?? `Chain ${chainId}`) : 'Not Connected'),
    [chainId]
  );

  // Initialize MetaMask event listeners and restore connection if already approved.
  useEffect(() => {
    const injected = getInjectedProvider();
    if (!provider || !injected) return undefined;

    const handleAccountsChanged = (accounts: string[]) => {
      const newAddress = accounts[0];
      if (newAddress) {
        setAddress(newAddress);
        linkWallet(newAddress);
        void provider
          .getSigner()
          .then(setSigner)
          .catch((walletError) => setError(getErrorMessage(walletError)));
      } else {
        setAddress(null);
        setSigner(null);
      }
    };

    const handleChainChanged = (newChainIdHex: string) => {
      setChainId(BigInt(newChainIdHex));
    };

    injected.on?.('accountsChanged', handleAccountsChanged);
    injected.on?.('chainChanged', handleChainChanged);

    let cancelled = false;
    void provider
      .listAccounts()
      .then(async (accounts) => {
        if (cancelled || accounts.length === 0) return;
        const newAddress = accounts[0]?.address;
        if (!newAddress) return;

        setAddress(newAddress);
        linkWallet(newAddress);
        setSigner(await provider.getSigner());
        const network = await provider.getNetwork();
        setChainId(network.chainId);
      })
      .catch((walletError) => {
        if (!cancelled) console.error(walletError);
      });

    return () => {
      cancelled = true;
      injected.removeListener?.('accountsChanged', handleAccountsChanged);
      injected.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [provider, linkWallet]);

  const connect = async () => {
    if (!provider) {
      setError('MetaMask not found. Please install the extension.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    try {
      await provider.send('eth_requestAccounts', []);
      const newSigner = await provider.getSigner();
      const newAddress = await newSigner.getAddress();
      const network = await provider.getNetwork();

      setSigner(newSigner);
      setAddress(newAddress);
      linkWallet(newAddress);
      setChainId(network.chainId);
    } catch (walletError) {
      setError(getErrorMessage(walletError));
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setSigner(null);
    setAddress(null);
    setChainId(null);
  };

  /**
   * Send real ETH on-chain. Used by the Wallet page for Sepolia testnet transfers.
   */
  const sendTransaction = async (to: string, amountEth: string): Promise<TransactionResult> => {
    if (!signer) throw new Error('Wallet not connected');
    if (!ethers.isAddress(to)) throw new Error('Invalid recipient address');

    const parsedAmount = Number(amountEth);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const tx = await signer.sendTransaction({
      to,
      value: ethers.parseEther(amountEth),
    });

    // Wait for 1 confirmation
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error('Transaction failed — no receipt');

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  };

  /**
   * Prompt MetaMask to switch to Sepolia testnet.
   */
  const switchToSepolia = async () => {
    const injected = getInjectedProvider();
    if (!injected) return;

    try {
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }], // 11155111 in hex
      });
    } catch (switchError) {
      // If Sepolia is not added to MetaMask, add it.
      if (getProviderErrorCode(switchError) === 4902) {
        await injected.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0xaa36a7',
              chainName: 'Sepolia Testnet',
              nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: [process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'],
              blockExplorerUrls: ['https://sepolia.etherscan.io'],
            },
          ],
        });
      } else {
        setError(getErrorMessage(switchError));
      }
    }
  };

  return (
    <Web3Context.Provider
      value={{
        provider,
        signer,
        address,
        chainId,
        networkName,
        connect,
        disconnect,
        isConnecting,
        error,
        sendTransaction,
        switchToSepolia,
      }}
    >
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) throw new Error('useWeb3 must be used within WalletProvider');
  return context;
}
