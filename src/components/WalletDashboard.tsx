"use client";

import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useKryptonStore } from '@/store/useKryptonStore';
import { useWeb3 } from '@/components/WalletProvider';
import { ethers } from 'ethers';

export default function WalletDashboard() {
  const { walletState, keys, updateWalletBalance } = useKryptonStore();
  const { provider, address: connectedAddress, connect, disconnect, isConnecting, networkName, switchToSepolia, sendTransaction } = useWeb3();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  
  // Modals state
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendAddress, setSendAddress] = useState('');
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [txResult, setTxResult] = useState<{ txHash: string; blockNumber: number } | null>(null);

  // Fetch real on-chain balance when MetaMask connects
  useEffect(() => {
    if (provider && connectedAddress) {
      provider.getBalance(connectedAddress).then(balance => {
        setRpcError(null);
        const ethBalance = parseFloat(ethers.formatEther(balance));
        updateWalletBalance("ETH", ethBalance);
      }).catch(err => {
        // Handle dead RPC endpoints silently so Next.js doesn't show the red overlay
        console.log("RPC Error fetching balance:", err.message);
        setRpcError("Unable to fetch balance. Your MetaMask might be connected to an offline RPC (like Localhost 8545). Please switch your network to Ethereum Mainnet.");
      });
    }
  }, [provider, connectedAddress, updateWalletBalance]);

  if (!walletState || !keys) {
    return <div className="p-6 text-white text-center mt-20">Loading wallet state...</div>;
  }

  const activeAddress = connectedAddress || keys.ethAddress;

  // Calculate mock fiat value for demo purposes based on assets
  const totalBalanceUSD = `$${(walletState.assets.reduce((acc, asset) => {
    let price = 0;
    if (asset.symbol === 'ETH') price = 3000;
    if (asset.symbol === 'USDC') price = 1;
    if (asset.symbol === 'KRYP') price = 0.5;
    return acc + (asset.balance * price);
  }, 0)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ 
            role: 'user', 
            content: `Here is my crypto portfolio: ${JSON.stringify(walletState.assets)}. Total value is ${totalBalanceUSD}. Please provide a 2 sentence analysis or tip on this portfolio allocation.` 
          }],
          systemPrompt: "You are a professional cryptocurrency portfolio analyst. Provide concise, insightful analysis."
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAiAnalysis(data.result);
      } else {
        setAiAnalysis("Error analyzing portfolio. Please try again.");
      }
    } catch {
      setAiAnalysis("Failed to connect to Krypton AI.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendAmount || !sendAddress) return;

    // If MetaMask is connected on Sepolia, do a real on-chain transfer
    if (connectedAddress && networkName === 'Sepolia') {
      setIsSending(true);
      setTxResult(null);
      try {
        const result = await sendTransaction(sendAddress, sendAmount);
        setTxResult(result);
        // Refresh balance
        if (provider) {
          const bal = await provider.getBalance(connectedAddress);
          updateWalletBalance('ETH', parseFloat(ethers.formatEther(bal)));
        }
      } catch (err: unknown) {
        alert(`Transaction failed: ${(err as Error).message || 'Unknown error'}`);
      } finally {
        setIsSending(false);
      }
    } else {
      alert(`Mock Send: Sending ${sendAmount} ETH to ${sendAddress}\n\nTo send real ETH, connect MetaMask on Sepolia testnet.`);
      setShowSendModal(false);
      setSendAmount('');
      setSendAddress('');
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto p-6 space-y-6 relative">
      
      {/* Top Section - Balance & Actions */}
      <div className="glass-panel p-8 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#58a6ff] opacity-10 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#1f6feb] opacity-10 rounded-full blur-3xl -ml-20 -mb-20"></div>
        
        <div className="flex items-center justify-between w-full mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Wallet</h1>
            <p className="text-gray-400 font-mono text-sm mt-1 bg-black/30 px-3 py-1 rounded-md inline-block border border-white/5">
              {activeAddress}
            </p>
          </div>
          
          <div className="flex gap-3">
            {connectedAddress ? (
              <button onClick={disconnect} className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-4 py-2 rounded-lg font-semibold transition-all">
                Disconnect MetaMask
              </button>
            ) : (
              <button onClick={connect} disabled={isConnecting} className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 px-4 py-2 rounded-lg font-semibold transition-all flex items-center">
                {isConnecting ? 'Connecting...' : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    Connect MetaMask
                  </>
                )}
              </button>
            )}
          </div>

          {/* Network Badge + Sepolia switch */}
          {connectedAddress && (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${
                networkName === 'Sepolia' ? 'bg-purple-500/15 text-purple-400 border-purple-500/30' :
                networkName === 'Mainnet' ? 'bg-green-500/15 text-green-400 border-green-500/30' :
                'bg-gray-500/15 text-gray-400 border-gray-500/30'
              }`}>
                {networkName}
              </span>
              {networkName !== 'Sepolia' && (
                <button
                  onClick={switchToSepolia}
                  className="text-[10px] text-purple-400 hover:text-purple-300 underline transition-colors"
                >
                  Switch to Sepolia
                </button>
              )}
            </div>
          )}
        </div>

        <span className="text-gray-400 text-sm font-medium tracking-wider uppercase mb-2 z-10">Total Balance</span>
        <h1 className="text-5xl font-extrabold text-white tracking-tight mb-6 z-10">{totalBalanceUSD}</h1>
        
        {rpcError && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 px-4 py-3 rounded-lg text-sm mb-6 z-10 relative">
            <div className="flex items-start">
              <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>{rpcError}</span>
            </div>
          </div>
        )}

        <div className="flex space-x-4 z-10">
          <button onClick={() => setShowSendModal(true)} className="bg-[#58a6ff] hover:bg-[#1f6feb] text-white px-8 py-3 rounded-full font-semibold shadow-lg shadow-[#58a6ff]/20 transition-all flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Send
          </button>
          <button onClick={() => setShowReceiveModal(true)} className="bg-[rgba(48,54,61,0.8)] hover:bg-[rgba(48,54,61,1)] text-white border border-gray-600 px-8 py-3 rounded-full font-semibold transition-all flex items-center shadow-lg">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Receive
          </button>
          <button 
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="bg-purple-600 hover:bg-purple-700 text-white border border-purple-500 px-6 py-3 rounded-full font-semibold transition-all flex items-center shadow-lg shadow-purple-500/20 disabled:opacity-50"
          >
            {isAnalyzing ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Analyzing...
              </span>
            ) : (
              <span className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                AI Analyzer
              </span>
            )}
          </button>
        </div>
      </div>

      {/* AI Analysis Result */}
      {aiAnalysis && (
        <div className="glass-panel p-6 rounded-2xl border-l-4 border-l-purple-500 bg-[rgba(147,51,234,0.1)] relative">
          <button onClick={() => setAiAnalysis(null)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h3 className="text-purple-400 font-bold mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            Krypton AI Insight
          </h3>
          <p className="text-gray-200 text-sm leading-relaxed">{aiAnalysis}</p>
        </div>
      )}

      {/* Middle Section - Address & Network */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Your Address (Derived from Mnemonic)</p>
            <p className="font-mono text-sm text-gray-300">{walletState.address.slice(0,8)}...{walletState.address.slice(-6)}</p>
          </div>
          <button 
            onClick={() => { navigator.clipboard.writeText(walletState.address); alert("Copied to clipboard!"); }}
            className="text-[#58a6ff] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
        </div>
        
        <div className="glass-panel p-6 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Network</p>
            <div className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
              <p className="text-sm font-semibold text-gray-200">{walletState.network}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section - Asset List */}
      <div className="glass-panel rounded-2xl overflow-hidden flex-1 flex flex-col shadow-lg">
        <div className="p-4 border-b border-[rgba(48,54,61,0.5)] bg-[rgba(22,27,34,0.4)]">
          <h3 className="font-semibold text-gray-200">Assets</h3>
        </div>
        <div className="overflow-y-auto">
          {walletState.assets.map((asset) => (
            <div key={asset.symbol} className="p-4 border-b border-[rgba(48,54,61,0.5)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 border border-gray-600 flex items-center justify-center font-bold text-white shadow-inner">
                  {asset.symbol.charAt(0)}
                </div>
                <div className="ml-4">
                  <p className="font-bold text-gray-100">{asset.name}</p>
                  <p className="text-xs text-gray-500">{asset.symbol}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-gray-100">{asset.balance.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Receive Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel w-full max-w-sm rounded-2xl p-6 relative">
            <button onClick={() => setShowReceiveModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h2 className="text-xl font-bold text-white mb-6 text-center">Receive Funds</h2>
            <div className="bg-white p-4 rounded-xl flex justify-center mb-6">
              <QRCodeSVG value={walletState.address} size={200} />
            </div>
            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 flex items-center justify-between">
              <p className="font-mono text-xs text-gray-300 break-all">{walletState.address}</p>
              <button 
                onClick={() => { navigator.clipboard.writeText(walletState.address); alert("Copied!"); }}
                className="ml-2 text-[#58a6ff] hover:text-white p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              </button>
            </div>
            <p className="text-center text-xs text-gray-500 mt-4">Send only ERC-20 tokens on {walletState.network} to this address.</p>
          </div>
        </div>
      )}

      {/* Send Modal */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel w-full max-w-sm rounded-2xl p-6 relative">
            <button onClick={() => setShowSendModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h2 className="text-xl font-bold text-white mb-6">Send Funds</h2>

            {/* Transaction success result */}
            {txResult ? (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                  <svg className="w-10 h-10 text-green-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <p className="text-green-400 font-bold text-lg">Transaction Confirmed!</p>
                  <p className="text-gray-400 text-xs mt-1">Block #{txResult.blockNumber}</p>
                </div>
                <div className="bg-black/30 rounded-lg p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Transaction Hash</p>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#58a6ff] hover:underline font-mono break-all"
                  >
                    {txResult.txHash}
                  </a>
                </div>
                <button
                  onClick={() => { setTxResult(null); setShowSendModal(false); setSendAmount(''); setSendAddress(''); }}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg font-bold transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendSubmit} className="space-y-4">
                {connectedAddress && networkName === 'Sepolia' && (
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-2 text-center">
                    <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest">🔗 Real On-Chain Transfer (Sepolia)</p>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Recipient Address</label>
                  <input 
                    type="text" 
                    value={sendAddress}
                    onChange={(e) => setSendAddress(e.target.value)}
                    placeholder="0x..."
                    required
                    className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white focus:border-[#58a6ff] outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Amount</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={sendAmount}
                      onChange={(e) => setSendAmount(e.target.value)}
                      placeholder="0.00"
                      required
                      className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white focus:border-[#58a6ff] outline-none transition-colors"
                    />
                    <span className="absolute right-3 top-3 text-gray-500 font-bold">ETH</span>
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={isSending}
                  className="w-full bg-[#58a6ff] hover:bg-[#1f6feb] text-white py-3 rounded-lg font-bold shadow-lg mt-2 transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  {isSending ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                      Confirming...
                    </>
                  ) : 'Confirm Send'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
