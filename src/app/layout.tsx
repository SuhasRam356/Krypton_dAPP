import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { WalletProvider } from "@/components/WalletProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Krypton dApp",
  description: "Robust Decentralized Messenger and Crypto Wallet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-krypton-dark text-white flex`}>
        <WalletProvider>
          <Sidebar />
          <main className="flex-1 overflow-hidden relative">
            {children}
          </main>
        </WalletProvider>
      </body>
    </html>
  );
}
