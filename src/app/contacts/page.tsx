'use client';

import { useState } from 'react';
import { useKryptonStore } from '@/store/useKryptonStore';
import { isValidKryptonId, normalizeKryptonId } from '@/crypto/keys';
import Link from 'next/link';

function isGradientAvatar(value?: string): boolean {
  return Boolean(value && (value.includes('from-') || value.includes('to-')));
}

function avatarClass(value?: string): string {
  return isGradientAvatar(value) ? `bg-gradient-to-tr ${value}` : '';
}

function avatarStyle(value?: string) {
  return !isGradientAvatar(value) ? { backgroundColor: value ?? '#30363d' } : undefined;
}

export default function ContactsPage() {
  const { contacts, addContact, removeContact, keys } = useKryptonStore();
  const [showAddModal, setShowAddModal] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [kryptonId, setKryptonId] = useState('');
  const [error, setError] = useState('');

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedId = normalizeKryptonId(kryptonId);
    if (!name.trim() || !normalizedId) return;
    if (!isValidKryptonId(normalizedId)) {
      setError('Enter a valid Krypton ID: 05 followed by a 32-byte public key in hex.');
      return;
    }
    if (keys?.kryptonId === normalizedId) {
      setError('You cannot add your own Krypton ID as a contact.');
      return;
    }

    const colors = ['#58a6ff', '#3fb950', '#d2a8ff', '#ff7b72', '#f2cc60'];
    const color = colors[Math.floor(Math.random() * colors.length)] ?? '#58a6ff';

    const saved = addContact({
      id: normalizedId,
      name: name.trim(),
      avatarColor: color,
    });

    if (!saved) {
      setError('Could not save this contact. Check the Krypton ID and try again.');
      return;
    }

    setShowAddModal(false);
    setName('');
    setKryptonId('');
  };

  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Address Book</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your secure Krypton connections</p>
        </div>
        <button
          onClick={() => {
            setError('');
            setShowAddModal(true);
          }}
          className="bg-[#58a6ff] hover:bg-[#1f6feb] text-white px-6 py-2.5 rounded-full font-semibold shadow-lg shadow-[#58a6ff]/20 transition-all flex items-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Contact
        </button>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-[rgba(33,38,45,0.6)] border border-[rgba(48,54,61,0.5)] rounded-xl p-5 hover:bg-[rgba(48,54,61,0.4)] transition-colors relative group"
            >
              <div className="flex items-start justify-between mb-4">
                <div
                  className={`w-14 h-14 rounded-full ${avatarClass(contact.avatarColor)} flex items-center justify-center shadow-lg shadow-black/20`}
                  style={avatarStyle(contact.avatarColor)}
                >
                  {contact.isAi ? (
                    <span className="text-2xl">🤖</span>
                  ) : (
                    <span className="text-xl font-bold text-white">
                      {contact.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                {!contact.isAi && (
                  <button
                    onClick={() => removeContact(contact.id)}
                    className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <h3 className="text-lg font-bold text-white mb-1">{contact.name}</h3>
              <p className="font-mono text-xs text-gray-400 break-all bg-black/30 p-2 rounded-lg mt-3 border border-white/5">
                {contact.id.slice(0, 12)}...{contact.id.slice(-10)}
              </p>

              <div className="mt-5 flex space-x-2">
                <Link
                  href={`/chat?contactId=${contact.id}`}
                  className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] text-white text-center py-2 rounded-lg text-sm font-semibold transition-colors border border-white/10"
                >
                  Message
                </Link>
                {!contact.isAi && (
                  <Link
                    href={`/chat?contactId=${contact.id}`}
                    className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] text-white text-center py-2 rounded-lg text-sm font-semibold transition-colors border border-white/10"
                  >
                    Transfer Note
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
        {contacts.length === 0 && (
          <div className="p-12 text-center text-gray-400">
            <svg
              className="w-16 h-16 mx-auto mb-4 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p>Your address book is empty. Add a contact to start messaging.</p>
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 relative shadow-2xl">
            <button
              onClick={() => {
                setError('');
                setShowAddModal(false);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-[#58a6ff]/20 flex items-center justify-center text-[#58a6ff]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white">Add New Contact</h2>
            </div>

            <form onSubmit={handleAddContact} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">
                  Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Satoshi"
                  required
                  className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white focus:border-[#58a6ff] outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">
                  Krypton ID
                </label>
                <p className="text-gray-500 text-xs mb-2">
                  Get this from your friend&apos;s Settings page. It&apos;s their address and
                  encryption key in one — nothing else to enter.
                </p>
                <input
                  type="text"
                  value={kryptonId}
                  onChange={(e) => setKryptonId(e.target.value)}
                  placeholder="05a1b2c3..."
                  required
                  className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white focus:border-[#58a6ff] font-mono text-sm outline-none transition-colors"
                />
              </div>
              {error && (
                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="w-full bg-[#58a6ff] hover:bg-[#1f6feb] text-white py-3.5 rounded-xl font-bold shadow-lg shadow-[#58a6ff]/20 mt-4 transition-all"
              >
                Save Contact
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
