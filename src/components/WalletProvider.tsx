"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ethers } from 'ethers';

interface Web3ContextType {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  address: string | null;
  chainId: bigint | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnecting: boolean;
  error: string | null;
}

const Web3Context = createContext<Web3ContextType | null>(null);

import { useKryptonStore } from '@/store/useKryptonStore';

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { linkWallet } = useKryptonStore();

  // Initialize provider if MetaMask exists
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
      setProvider(browserProvider);

      // Handle account changes
      (window as any).ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length > 0) {
          const newAddress = accounts[0] as string;
          setAddress(newAddress);
          linkWallet(newAddress);
          browserProvider.getSigner().then(setSigner);
        } else {
          setAddress(null);
          setSigner(null);
        }
      });

      // Handle chain changes
      (window as any).ethereum.on('chainChanged', () => {
        window.location.reload();
      });
      
      // Auto-connect if already connected
      browserProvider.listAccounts().then(accounts => {
        if (accounts.length > 0) {
          const newAddress = accounts[0]?.address;
          if (newAddress) {
            setAddress(newAddress);
            linkWallet(newAddress);
          }
          browserProvider.getSigner().then(setSigner);
        }
      }).catch(console.error);
    }
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
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setSigner(null);
    setAddress(null);
    setChainId(null);
  };

  return (
    <Web3Context.Provider value={{ provider, signer, address, chainId, connect, disconnect, isConnecting, error }}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) throw new Error("useWeb3 must be used within WalletProvider");
  return context;
}
