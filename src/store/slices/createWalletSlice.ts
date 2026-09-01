/**
 * Zustand slice: Wallet State
 *
 * Owns the wallet address linkage and asset balances.
 * Connecting MetaMask only updates the displayed ETH address —
 * it never touches `keys` or the chat identity.
 */

import type { StateCreator } from 'zustand';
import type { WalletState } from '@/types';
import type { KryptonStore } from '../useKryptonStore';

// ── Slice interface ──

export interface WalletSlice {
  walletState: WalletState | null;
  linkWallet: (address: string) => void;
  updateWalletBalance: (symbol: string, balance: number) => void;
}

// ── Slice creator ──

export const createWalletSlice: StateCreator<KryptonStore, [], [], WalletSlice> = (set) => ({
  walletState: null,

  linkWallet: (address: string) =>
    set((state) => ({
      walletState: state.walletState ? { ...state.walletState, address } : state.walletState,
    })),

  updateWalletBalance: (symbol, balance) =>
    set((state) => {
      if (!state.walletState) return state;
      return {
        walletState: {
          ...state.walletState,
          assets: state.walletState.assets.map((asset) =>
            asset.symbol === symbol ? { ...asset, balance } : asset
          ),
        },
      };
    }),
});
