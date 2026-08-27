"use client";

import { useState, useEffect, ReactNode } from 'react';
import sodium from 'libsodium-wrappers';
import { generateSalt, deriveKeyFromPin, setVaultKey, getVaultKey } from '@/crypto/vault';
import { useKryptonStore } from '@/store/useKryptonStore';

export default function LockScreen({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isNewDevice, setIsNewDevice] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Check if a vault already exists
  useEffect(() => {
    const init = async () => {
      await sodium.ready;
      const existingSalt = localStorage.getItem('krypton-vault-salt');
      if (!existingSalt) {
        setIsNewDevice(true);
      }
      setIsLoading(false);
    };
    init();
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    
    setError('');
    setIsLoading(true);

    try {
      await sodium.ready;
      let saltStr = localStorage.getItem('krypton-vault-salt');
      let saltBytes: Uint8Array;

      if (isNewDevice || !saltStr) {
        // Create new salt and save it
        saltBytes = await generateSalt();
        localStorage.setItem('krypton-vault-salt', sodium.to_base64(saltBytes));
      } else {
        saltBytes = sodium.from_base64(saltStr);
      }

      // Derive the AES key from the PIN + Salt
      const key = await deriveKeyFromPin(pin, saltBytes);
      setVaultKey(key);

      // Now that the key is in memory, rehydrate the Zustand store
      // Since rehydration is async inside Zustand (or at least we want to wait for it), 
      // we just call it and it will trigger a state update.
      await useKryptonStore.persist.rehydrate();
      
      setIsUnlocked(true);
    } catch (err: any) {
      console.error(err);
      setError("Invalid PIN or corrupted vault.");
      setVaultKey(null);
    } finally {
      setIsLoading(false);
    }
  };

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0d1117] text-white">
      <div className="glass-panel p-8 rounded-2xl w-full max-w-sm text-center shadow-2xl border border-[rgba(88,166,255,0.1)]">
        <div className="w-16 h-16 mx-auto bg-[#161b22] rounded-full flex items-center justify-center mb-6 shadow-lg border border-gray-700">
          <svg className="w-8 h-8 text-[#58a6ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        </div>
        
        <h2 className="text-2xl font-bold mb-2">
          {isNewDevice ? "Create Vault PIN" : "Unlock Krypton"}
        </h2>
        <p className="text-sm text-gray-400 mb-6">
          {isNewDevice ? "Set a PIN to encrypt your keys and messages on this device." : "Enter your PIN to decrypt your vault."}
        </p>

        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={isLoading}
            autoFocus
            placeholder="****"
            className="w-full bg-[#161b22] border border-gray-700 rounded-xl p-4 text-center text-2xl tracking-widest outline-none focus:border-[#58a6ff] transition-colors"
          />
          
          {error && <p className="text-red-400 text-xs">{error}</p>}
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#58a6ff] hover:bg-[#1f6feb] text-white font-bold py-3 rounded-xl shadow-lg transition-colors flex items-center justify-center disabled:opacity-50"
          >
            {isLoading ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            ) : (
              isNewDevice ? "Create Vault" : "Unlock"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
