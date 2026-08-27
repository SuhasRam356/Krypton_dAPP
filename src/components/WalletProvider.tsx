"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ethers } from 'ethers';

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

declare global {
  interface Window {
    ethereum?: {
      on: (eventName: string, handler: (args: unknown) => void) => void;
      removeListener: (eventName: string, handler: (args: unknown) => void) => void;
      request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const Web3Context = createContext<Web3ContextType | null>(null);

import { useKryptonStore } from '@/store/useKryptonStore';

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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { linkWallet } = useKryptonStore();

  const networkName = chainId ? (CHAIN_NAMES[chainId.toString()] || `Chain ${chainId}`) : 'Not Connected';

  // Initialize provider if MetaMask exists
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      // Create provider
      const browserProvider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
      setTimeout(() => setProvider(browserProvider), 0);

      const handleAccountsChanged = (accounts: unknown) => {
        const accs = accounts as string[];
        if (accs.length > 0) {
          const newAddress = accs[0] as string;
          setAddress(newAddress);
          linkWallet(newAddress);
          browserProvider.getSigner().then(setSigner).catch(console.error);
        } else {
          setAddress(null);
          setSigner(null);
        }
      };

      const handleChainChanged = (newChainIdHex: unknown) => {
        setChainId(BigInt(newChainIdHex as string));
      };

      // Handle account changes
      window.ethereum.on('accountsChanged', handleAccountsChanged);

      // Handle chain changes — update chainId instead of reloading
      window.ethereum.on('chainChanged', handleChainChanged);
      
      // Auto-connect if already connected
      browserProvider.listAccounts().then(accounts => {
        if (accounts.length > 0) {
          const newAddress = accounts[0]?.address;
          if (newAddress) {
            setAddress(newAddress);
            linkWallet(newAddress);
          }
          browserProvider.getSigner().then(setSigner).catch(console.error);
          browserProvider.getNetwork().then(net => setChainId(net.chainId)).catch(console.error);
        }
      }).catch(console.error);

      return () => {
        if (window.ethereum) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
    return undefined;
  }, [linkWallet]);

  const connect = async () => {
    if (!provider) {
      setError("MetaMask not found. Please install the extension.");
      return;
    }
    
    setIsConnecting(true);
    setError(null);
    try {
      await provider.send("eth_requestAccounts", []);
      const newSigner = await provider.getSigner();
      const newAddress = await newSigner.getAddress();
      const network = await provider.getNetwork();
      
      setSigner(newSigner);
      setAddress(newAddress);
      linkWallet(newAddress);
      setChainId(network.chainId);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to connect wallet");
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
   * Send real ETH on-chain.
   * Used for in-chat Sepolia transfers.
   */
  const sendTransaction = async (to: string, amountEth: string): Promise<TransactionResult> => {
    if (!signer) throw new Error("Wallet not connected");

    const tx = await signer.sendTransaction({
      to,
      value: ethers.parseEther(amountEth)
    });

    // Wait for 1 confirmation
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error("Transaction failed — no receipt");

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  };

  /**
   * Prompt MetaMask to switch to Sepolia testnet.
   */
  const switchToSepolia = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    try {
      if (!window.ethereum) throw new Error("No ethereum provider");
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }], // 11155111 in hex
      });
    } catch (switchError: unknown) {
      const err = switchError as { code: number; message: string };
      // This error code indicates that the chain has not been added to MetaMask.
      if (err.code === 4902) {
        try {
          if (!window.ethereum) return;
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0xaa36a7',
                chainName: 'Sepolia test network',
                nativeCurrency: {
                  name: 'SepoliaETH',
                  symbol: 'SEP',
                  decimals: 18,
                },
                rpcUrls: ['https://sepolia.infura.io/v3/'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
        } catch (addError) {
          console.error("Failed to add Sepolia network", addError);
        }
      } else {
        console.error("Failed to switch network", err);
      }
    }
  };

  return (
    <Web3Context.Provider value={{
      provider, signer, address, chainId, networkName,
      connect, disconnect, isConnecting, error,
      sendTransaction, switchToSepolia
    }}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) throw new Error("useWeb3 must be used within WalletProvider");
  return context;
}
