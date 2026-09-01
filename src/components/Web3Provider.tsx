'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmi';

/**
 * Top-level Web3 provider that wraps the app with Wagmi + React Query.
 *
 * This replaces the old hand-rolled WalletProvider context. All wallet
 * interactions now go through Wagmi hooks (useAccount, useConnect, etc.)
 * via the compatibility shim in WalletProvider.tsx.
 */
export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
