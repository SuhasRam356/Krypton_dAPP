import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { Web3Provider } from '@/components/Web3Provider';
import { WalletProvider } from '@/components/WalletProvider';
import LockScreen from '@/components/LockScreen';

export const metadata: Metadata = {
  title: 'Krypton dApp',
  description: 'Robust Decentralized Messenger and Crypto Wallet',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0d1117] text-white flex">
        <LockScreen>
          <Web3Provider>
            <WalletProvider>
              <Sidebar />
              <main className="flex-1 overflow-hidden relative">{children}</main>
            </WalletProvider>
          </Web3Provider>
        </LockScreen>
      </body>
    </html>
  );
}
