'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useKryptonStore } from '@/store/useKryptonStore';
import { useWeb3 } from '@/components/WalletProvider';

export default function SettingsPage() {
  const { keys, walletState } = useKryptonStore();
  const { address: connectedAddress } = useWeb3();
  const [copied, setCopied] = useState<'id' | 'wallet' | 'mnemonic' | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);

  const linkedWallet =
    connectedAddress || walletState?.address || (keys ? keys.ethAddress : 'Not Generated');

  const copyToClipboard = (text: string, type: 'id' | 'wallet' | 'mnemonic') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!keys) {
    return <div className="p-6 text-center text-white mt-20">Initializing identity...</div>;
  }

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Profile & Identity</h1>
        <p className="text-gray-400 text-sm mt-1">
          Manage your cryptographic footprint on the Krypton network
        </p>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl p-8 relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#58a6ff] opacity-10 rounded-full blur-3xl -mr-20 -mt-20"></div>

        <h2 className="text-xl font-bold text-white mb-6 z-10 relative flex items-center">
          <svg
            className="w-6 h-6 mr-3 text-[#58a6ff]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          Your Krypton ID
        </h2>

        <div className="space-y-6 z-10 relative">
          {/* Krypton ID — the single chat identity, doubles as the encryption pubkey */}
          <div className="bg-[#0d1117] border border-gray-700 rounded-xl p-5">
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">
              Krypton ID
            </label>
            <p className="text-gray-500 text-sm mb-3">
              Share this with friends so they can message you. It IS your encryption key —
              there&apos;s nothing else to exchange, and it never changes even if you switch or
              disconnect MetaMask.
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg shrink-0">
                <QRCodeSVG value={keys.kryptonId} size={140} />
              </div>
              <div className="flex-1 w-full space-y-2">
                <div className="flex items-center space-x-3">
                  <code className="flex-1 bg-black/40 text-gray-200 p-3 rounded-lg text-sm border border-white/5 break-all">
                    {keys.kryptonId}
                  </code>
                  <button
                    onClick={() => copyToClipboard(keys.kryptonId, 'id')}
                    className="bg-[#21262d] hover:bg-[#30363d] text-white p-3 rounded-lg transition-colors border border-gray-600 flex-shrink-0"
                    title="Copy Krypton ID"
                  >
                    {copied === 'id' ? (
                      <svg
                        className="w-5 h-5 text-green-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Linked wallet — optional, only used for crypto transfers, never for chat */}
          <div className="bg-[#0d1117] border border-gray-700 rounded-xl p-5">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                Linked Wallet (crypto transfers only)
              </label>
              {connectedAddress && (
                <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-green-500/30">
                  MetaMask Connected
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm mb-3">
              Used for Wallet-page transfers and optional in-chat transfer notes. Switching this
              wallet never affects your Krypton ID or message history.
            </p>

            <div className="flex items-center space-x-3">
              <code className="flex-1 bg-black/40 text-gray-200 p-3 rounded-lg text-sm border border-white/5 break-all">
                {linkedWallet}
              </code>
              <button
                onClick={() => copyToClipboard(linkedWallet, 'wallet')}
                className="bg-[#21262d] hover:bg-[#30363d] text-white p-3 rounded-lg transition-colors border border-gray-600 flex-shrink-0"
                title="Copy Wallet Address"
              >
                {copied === 'wallet' ? (
                  <svg
                    className="w-5 h-5 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Recovery phrase — encrypted at rest, revealed only on demand */}
          <div className="bg-[#0d1117] border border-yellow-500/30 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <label className="text-xs text-yellow-400 uppercase tracking-wider font-semibold">
                  Recovery Phrase
                </label>
                <p className="text-gray-500 text-sm mt-2">
                  Store this offline. Anyone with these words can restore your Krypton identity and
                  derived demo wallet.
                </p>
              </div>
              <button
                onClick={() => setShowMnemonic((visible) => !visible)}
                className="bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 px-3 py-2 rounded-lg text-xs font-bold border border-yellow-500/20 transition-colors"
              >
                {showMnemonic ? 'Hide' : 'Reveal'}
              </button>
            </div>

            {showMnemonic ? (
              <div className="space-y-3">
                <code className="block bg-black/40 text-gray-200 p-4 rounded-lg text-sm border border-white/5 break-words leading-7">
                  {keys.mnemonic}
                </code>
                <button
                  onClick={() => copyToClipboard(keys.mnemonic, 'mnemonic')}
                  className="bg-[#21262d] hover:bg-[#30363d] text-white px-4 py-2 rounded-lg transition-colors border border-gray-600 text-sm"
                >
                  {copied === 'mnemonic' ? 'Copied recovery phrase' : 'Copy recovery phrase'}
                </button>
              </div>
            ) : (
              <div className="bg-black/30 border border-gray-800 rounded-lg p-4 text-gray-600 text-sm tracking-widest select-none">
                •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
