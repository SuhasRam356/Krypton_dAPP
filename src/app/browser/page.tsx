import Web3Browser from '@/components/Web3Browser';

export default function BrowserPage() {
  return (
    <div className="w-full h-full flex flex-col bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] bg-opacity-20 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#161b22] to-[#0d1117] -z-10 opacity-80" />
      <div className="p-6 border-b border-[rgba(48,54,61,0.5)]">
        <h1 className="text-2xl font-bold text-white">dApp Browser</h1>
        <p className="text-sm text-gray-400 mt-1">
          A sandboxed environment to interact with decentralized applications.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <Web3Browser />
      </div>
    </div>
  );
}
