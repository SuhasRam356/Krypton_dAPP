'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import type { KryptonMessage, MessageEnvelope } from '@/types';
import { encryptForContact, encryptWithRatchetDemo } from '@/crypto/encryption';
import { fromHex, isValidKryptonId } from '@/crypto/keys';
import { useKryptonStore } from '@/store/useKryptonStore';

// ── Self-destruct timer options ──
const DESTRUCT_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '30s', value: 30 },
  { label: '1 min', value: 60 },
  { label: '5 min', value: 300 },
  { label: '1 hour', value: 3600 },
];

const nowMs = () => Date.now();
const createMessageId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${nowMs()}-${Math.random().toString(36).slice(2)}`;

function isGradientAvatar(value?: string): boolean {
  return Boolean(value && (value.includes('from-') || value.includes('to-')));
}

function avatarStyle(value?: string): CSSProperties | undefined {
  return !isGradientAvatar(value) ? { backgroundColor: value ?? '#30363d' } : undefined;
}

function avatarGradientClass(value?: string): string {
  return isGradientAvatar(value) ? `bg-gradient-to-tr ${value}` : '';
}

function isAiResponse(value: unknown): value is { result: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { result?: unknown }).result === 'string'
  );
}

export default function ChatWindow() {
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get('contactId');

  const {
    messages,
    addMessage,
    deleteMessage,
    unsendMessage,
    keys,
    generateKeys,
    contacts,
    selfDestructTTL,
    setSelfDestructTimer,
    isRelayConnected,
    offlineQueue,
    ratchetStates,
    initRatchetForContact,
  } = useKryptonStore();

  const [activeContactId, setActiveContactId] = useState<string | null>(
    initialContactId || (contacts && contacts.length > 0 ? contacts[0]?.id || null : null)
  );

  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');

  // Attachment state
  const [attachment, setAttachment] = useState<{
    data: string;
    filename: string;
    mimeType: string;
    size: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msgId: string;
    isMe: boolean;
  } | null>(null);

  // Self-destruct dropdown
  const [showDestructDropdown, setShowDestructDropdown] = useState(false);

  // Self-destruct countdown (re-renders every second)
  const [now, setNow] = useState(() => nowMs());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Ensure keys exist
  useEffect(() => {
    if (!keys) generateKeys();
  }, [keys, generateKeys]);

  // Self-destruct ticker — check and delete expired messages every second
  useEffect(() => {
    const interval = setInterval(() => {
      const currentTime = nowMs();
      setNow(currentTime);
      const { messages, deleteMessage } = useKryptonStore.getState();
      for (const msg of messages) {
        if (msg.selfDestructAt && msg.selfDestructAt <= currentTime && !msg.isDeleted) {
          deleteMessage(msg.id);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    if (contextMenu) window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const resolvedActiveContactId =
    activeContactId && contacts.some((contact) => contact.id === activeContactId)
      ? activeContactId
      : (contacts[0]?.id ?? null);
  const activeContact = contacts.find((c) => c.id === resolvedActiveContactId);
  const activeMessages = messages.filter(
    (m) =>
      (m.sender === resolvedActiveContactId && m.recipient === keys?.kryptonId) ||
      (m.sender === keys?.kryptonId && m.recipient === resolvedActiveContactId)
  );

  const filteredContacts = contacts.filter((contact) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return contact.name.toLowerCase().includes(query) || contact.id.toLowerCase().includes(query);
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      alert('File size exceeds 1MB limit for P2P transfer.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result as string;
      setAttachment({
        data,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (isCryptoTransfer = false, amount = 0, symbol = 'KRYP') => {
    if ((!input.trim() && !isCryptoTransfer && !attachment) || !keys || !activeContact) return;

    if (!activeContact.isAi && !isValidKryptonId(activeContact.id)) {
      alert('Invalid Krypton ID for this contact.');
      return;
    }

    if (isCryptoTransfer && (!Number.isFinite(amount) || amount <= 0)) {
      alert('Enter a transfer amount greater than zero.');
      return;
    }

    const userText = isCryptoTransfer ? `Transfer note: ${amount} ${symbol}` : input.trim();
    const timestamp = nowMs();
    const id = createMessageId();
    setInput('');
    const currentAttachment = attachment;
    setAttachment(null);
    if (showTransferModal) setShowTransferModal(false);

    // Encrypt the payload using the contact's Krypton ID, which IS their public key.
    // For AI we mock it with our own key because the AI assistant is local/cloud-assisted,
    // not a real decentralized Krypton identity.
    const targetPubKey = activeContact.isAi ? keys.messagingPublicKey : fromHex(activeContact.id);

    let ciphertext = '';
    let ratchetIndex: number | undefined;
    let initPayload: { ephemeralPublicKey: string; kyberCiphertext?: string } | undefined;

    if (activeContact.isAi) {
      // The AI just gets the text and doesn't handle attachments right now, 
      // but we will still append the attachment string for now if it exists.
      const aiText = currentAttachment ? `${userText}\n[Attached: ${currentAttachment.filename}]` : userText;
      ciphertext = await encryptForContact(aiText, keys.messagingPrivateKey, targetPubKey);
    } else {
      const envelope: MessageEnvelope = {
        version: 1,
        id,
        timestamp,
        sender: keys.kryptonId,
        recipient: activeContact.id,
        body: userText,
        ...(isCryptoTransfer
          ? { isCryptoTransfer, transferAmount: amount, transferSymbol: symbol }
          : {}),
        ...(selfDestructTTL ? { selfDestructTTL } : {}),
        ...(currentAttachment ? { attachment: currentAttachment } : {}),
      };

      let ratchetState = ratchetStates[activeContact.id];
      if (!ratchetState) {
        await initRatchetForContact(activeContact.id);
        ratchetState = useKryptonStore.getState().ratchetStates[activeContact.id];
      }
      if (!ratchetState) {
        alert('Failed to initialize secure connection.');
        return;
      }
      
      if (ratchetState.initializationPayload) {
        initPayload = ratchetState.initializationPayload;
        // Strip it out of state so we don't send it again
        const newState = { ...ratchetState };
        delete newState.initializationPayload;
        ratchetState = newState;
      }

      // Encrypt the message with our Double Ratchet state
      const result = await encryptWithRatchetDemo(JSON.stringify(envelope), ratchetState);

      // In Double Ratchet, state is a single unified object. We replace the whole state.
      useKryptonStore.setState((state) => ({
        ratchetStates: {
          ...state.ratchetStates,
          [activeContact.id]: result.newState,
        },
      }));
      ciphertext = result.ciphertext;
      ratchetIndex = result.ratchetIndex;
    }

    const newMsg: KryptonMessage = {
      id,
      timestamp,
      sender: keys.kryptonId,
      recipient: activeContact.id,
      type: 'ONION_ROUTED',
      ...(initPayload ? { initializationPayload: initPayload } : {}),
      encryptedPayload: ciphertext,
      decryptedPayload: userText,
      metadataStripped: true,
      routePath: ['p2p-relay'],
      ...(ratchetIndex !== undefined ? { ratchetIndex } : {}),
      ...(isCryptoTransfer ? { isCryptoTransfer } : {}),
      ...(typeof amount === 'number' && isCryptoTransfer ? { transferAmount: amount } : {}),
      ...(typeof symbol === 'string' && isCryptoTransfer ? { transferSymbol: symbol } : {}),
      ...(selfDestructTTL ? { selfDestructTTL } : {}),
      ...(currentAttachment ? { attachment: currentAttachment } : {}),
    };

    addMessage(newMsg);

    // AI Response Logic
    if (activeContact.isAi && !isCryptoTransfer) {
      setIsAiTyping(true);
      try {
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: userText }],
            systemPrompt:
              'You are Krypton AI, a helpful, deeply knowledgeable cryptocurrency and cryptography assistant embedded in an end-to-end encrypted messenger. Keep answers concise.',
          }),
        });

        if (response.ok) {
          const data: unknown = await response.json();
          if (!isAiResponse(data)) return;

          const aiCiphertext = await encryptForContact(
            data.result,
            keys.messagingPrivateKey, // Mock signing for local assistant demo.
            keys.messagingPublicKey
          );
          const aiTimestamp = nowMs() + 1000;

          const aiMsg: KryptonMessage = {
            id: createMessageId(),
            timestamp: aiTimestamp,
            sender: activeContact.id,
            recipient: keys.kryptonId,
            type: 'ONION_ROUTED',
            encryptedPayload: aiCiphertext,
            decryptedPayload: data.result,
            metadataStripped: true,
            routePath: ['ai-service'],
          };
          addMessage(aiMsg);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsAiTyping(false);
      }
    }
  };

  // ── Context menu handler ──
  const handleContextMenu = (e: React.MouseEvent, msgId: string, isMe: boolean) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, msgId, isMe });
  };

  // ── Format countdown ──
  const formatCountdown = (destructAt: number): string => {
    const remaining = Math.max(0, Math.ceil((destructAt - now) / 1000));
    if (remaining > 60) return `${Math.floor(remaining / 60)}m ${remaining % 60}s`;
    return `${remaining}s`;
  };

  return (
    <div className="flex h-full w-full max-w-7xl mx-auto p-4 gap-4">
      {/* Sidebar: Contacts List */}
      <div className="w-80 glass-panel rounded-xl flex flex-col overflow-hidden shadow-2xl border-[rgba(88,166,255,0.05)]">
        <div className="p-4 border-b border-[rgba(48,54,61,0.5)] bg-[rgba(22,27,34,0.8)]">
          <h2 className="font-bold text-gray-100 text-lg">Chats</h2>
          <div className="mt-3 relative">
            <svg
              className="w-4 h-4 absolute left-3 top-2.5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search contacts..."
              className="w-full bg-[#0d1117] border border-gray-700 rounded-full pl-9 pr-4 py-2 text-sm text-gray-200 outline-none focus:border-[#58a6ff] transition-colors"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredContacts.map((contact) => {
            const contactMessages = messages.filter(
              (m) =>
                (m.sender === contact.id && m.recipient === keys?.kryptonId) ||
                (m.sender === keys?.kryptonId && m.recipient === contact.id)
            );
            const lastMessage = contactMessages[contactMessages.length - 1];
            const displayTime = lastMessage
              ? new Date(lastMessage.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';

            return (
              <div
                key={contact.id}
                onClick={() => setActiveContactId(contact.id)}
                className={`p-4 border-b border-[rgba(48,54,61,0.5)] flex items-center cursor-pointer transition-colors ${resolvedActiveContactId === contact.id ? 'bg-[rgba(88,166,255,0.1)] border-l-2 border-l-[#58a6ff]' : 'hover:bg-[rgba(255,255,255,0.02)] border-l-2 border-l-transparent'}`}
              >
                <div
                  className={`w-12 h-12 rounded-full ${avatarGradientClass(contact.avatarColor)} flex items-center justify-center shadow-lg flex-shrink-0`}
                  style={avatarStyle(contact.avatarColor)}
                >
                  {contact.isAi ? (
                    <span className="text-xl">🤖</span>
                  ) : (
                    <span className="font-bold text-white">{contact.name.charAt(0)}</span>
                  )}
                </div>
                <div className="ml-3 overflow-hidden flex-1">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-gray-100 truncate">{contact.name}</h3>
                    <span className="text-[10px] text-gray-500">{displayTime}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {contact.id.slice(0, 6)}...{contact.id.slice(-4)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="glass-panel flex-1 rounded-xl flex flex-col overflow-hidden shadow-2xl relative">
        {activeContact ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-[rgba(48,54,61,0.5)] flex items-center justify-between bg-[rgba(22,27,34,0.8)] shadow-sm z-10">
              <div className="flex items-center space-x-3">
                <div
                  className={`w-10 h-10 rounded-full ${avatarGradientClass(activeContact.avatarColor)} shadow-lg flex items-center justify-center`}
                  style={avatarStyle(activeContact.avatarColor)}
                >
                  {activeContact.isAi ? (
                    <span className="text-lg">🤖</span>
                  ) : (
                    <span className="font-bold text-white text-sm">
                      {activeContact.name.charAt(0)}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-gray-100">{activeContact.name}</h3>
                  <p className="text-xs text-green-400 flex items-center">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse"></span>
                    E2E Encrypted
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                {/* Offline Queue Badge */}
                {!isRelayConnected && (
                  <div className="bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full flex items-center">
                    <svg
                      className="w-3 h-3 mr-1.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072"
                      />
                    </svg>
                    Offline{offlineQueue.length > 0 ? ` · ${offlineQueue.length} queued` : ''}
                  </div>
                )}

                {/* Self-Destruct Timer Button */}
                <div className="relative">
                  <button
                    onClick={() => setShowDestructDropdown(!showDestructDropdown)}
                    title="Disappearing Messages"
                    className={`transition-colors p-2 rounded-full ${selfDestructTTL ? 'text-orange-400 bg-orange-500/15 border border-orange-500/30 shadow-[0_0_8px_rgba(249,115,22,0.2)]' : 'text-purple-400 hover:text-purple-300 bg-purple-500/10'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                  {showDestructDropdown && (
                    <div className="absolute right-0 top-12 bg-[#161b22] border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden w-48">
                      <div className="px-3 py-2 border-b border-gray-700">
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                          Disappearing Messages
                        </p>
                      </div>
                      {DESTRUCT_OPTIONS.map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => {
                            setSelfDestructTimer(opt.value);
                            setShowDestructDropdown(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${selfDestructTTL === opt.value ? 'bg-orange-500/10 text-orange-400' : 'text-gray-300 hover:bg-white/5'}`}
                        >
                          <span>{opt.label}</span>
                          {selfDestructTTL === opt.value && (
                            <svg
                              className="w-4 h-4 text-orange-400"
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
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selfDestructTTL && (
                  <span className="text-[10px] text-orange-400 font-bold bg-orange-500/10 px-2 py-1 rounded-full border border-orange-500/20">
                    🔥 {selfDestructTTL}s
                  </span>
                )}

                <button
                  title="Contact Info"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Message List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex justify-center my-6">
                <div className="bg-[#161b22]/80 border border-yellow-500/30 px-4 py-2 rounded-xl text-center max-w-sm">
                  <p className="text-xs text-yellow-500/80 mb-1 font-semibold flex items-center justify-center">
                    <svg
                      className="w-4 h-4 mr-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                    End-to-End Encrypted Session
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Messages and transfers to this chat are secured with Curve25519 and routed
                    through the decentralized network.
                  </p>
                </div>
              </div>

              {activeMessages.map((msg) => {
                const isMe = keys && msg.sender === keys.kryptonId;

                // ── Tombstoned (unsent) message ──
                if (msg.isDeleted) {
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className="bg-[#21262d]/50 border border-dashed border-gray-700 rounded-2xl px-4 py-3 max-w-[75%] flex items-center space-x-2">
                        <svg
                          className="w-4 h-4 text-gray-600 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                          />
                        </svg>
                        <span className="text-sm text-gray-600 italic">
                          This message was unsent
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}
                    onContextMenu={(e) => handleContextMenu(e, msg.id, !!isMe)}
                  >
                    <div
                      className={`${isMe ? 'bg-gradient-to-br from-[#58a6ff] to-[#1f6feb] text-white rounded-tr-none' : 'bg-[#21262d] border border-[rgba(48,54,61,0.5)] text-gray-200 rounded-tl-none'} rounded-2xl p-1 max-w-[75%] shadow-lg relative`}
                    >
                      {/* In-chat Crypto Transfer UI */}
                      {msg.isCryptoTransfer ? (
                        <div className="m-1 rounded-xl bg-black/20 p-4 border border-white/10 w-64">
                          <div className="flex justify-between items-center mb-3">
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                              <svg
                                className="w-4 h-4 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M13 10V3L4 14h7v7l9-11h-7z"
                                />
                              </svg>
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wider">
                              {isMe ? 'Sent' : 'Received'}
                            </span>
                          </div>
                          <h4 className="text-2xl font-black mb-1">
                            {msg.transferAmount}{' '}
                            <span className="text-sm font-medium">{msg.transferSymbol}</span>
                          </h4>
                          <p className="text-[10px] opacity-70 font-mono mt-2 pt-2 border-t border-white/10">
                            Encrypted note:{' '}
                            {msg.type === 'ONION_ROUTED'
                              ? msg.encryptedPayload.slice(0, 8)
                              : msg.payload.slice(0, 8)}
                            ...
                          </p>
                        </div>
                      ) : (
                        <div className="px-4 py-2 break-words">
                          <p className="text-[9px] font-mono opacity-40 mb-1 border-b border-white/10 pb-1 flex items-center">
                            <svg
                              className="w-3 h-3 mr-1 inline"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                              />
                            </svg>
                            Encrypted Hash:{' '}
                            {msg.type === 'ONION_ROUTED'
                              ? msg.encryptedPayload.slice(0, 16)
                              : msg.payload.slice(0, 16)}
                            ...
                          </p>
                          {msg.attachment && (
                            <div className="mt-2 mb-2 rounded overflow-hidden">
                              {msg.attachment.mimeType.startsWith('image/') ? (
                                <img src={msg.attachment.data} alt={msg.attachment.filename} className="max-w-full rounded" />
                              ) : (
                                <a
                                  href={msg.attachment.data}
                                  download={msg.attachment.filename}
                                  className="flex items-center space-x-2 bg-black/20 p-3 rounded-lg border border-white/10 hover:bg-black/30 transition"
                                >
                                  <svg className="w-6 h-6 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                  <div className="flex flex-col flex-1 overflow-hidden min-w-0">
                                    <span className="text-sm font-medium truncate">{msg.attachment.filename}</span>
                                    <span className="text-[10px] opacity-70">{Math.round(msg.attachment.size / 1024)} KB</span>
                                  </div>
                                  <svg className="w-5 h-5 opacity-70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                </a>
                              )}
                            </div>
                          )}
                          <p className="opacity-95 leading-relaxed whitespace-pre-wrap text-sm">
                            {msg.decryptedPayload}
                          </p>
                        </div>
                      )}

                      <div
                        className={`flex items-center space-x-1.5 px-3 pb-2 ${isMe ? 'justify-end' : 'justify-start'}`}
                      >
                        <span className="text-[10px] opacity-60 font-medium">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {isMe && (
                          <svg
                            className="w-3 h-3 opacity-60"
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
                        )}
                        {/* Self-destruct countdown */}
                        {msg.selfDestructAt && (
                          <span className="text-[9px] text-orange-400 font-bold flex items-center ml-1">
                            🔥 {formatCountdown(msg.selfDestructAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isAiTyping && (
                <div className="flex justify-start">
                  <div className="bg-[#21262d] border border-[rgba(48,54,61,0.5)] text-gray-200 rounded-2xl rounded-tl-none px-4 py-4 shadow-lg">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                      <div
                        className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                        style={{ animationDelay: '0.1s' }}
                      ></div>
                      <div
                        className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                        style={{ animationDelay: '0.2s' }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-[rgba(48,54,61,0.5)] bg-[rgba(22,27,34,0.6)] flex flex-col">
              {attachment && (
                <div className="mb-3 bg-[#161b22] border border-gray-700 rounded-lg p-2.5 flex items-center justify-between shadow-inner">
                  <div className="flex items-center space-x-3 text-sm text-gray-300">
                    {attachment.mimeType.startsWith('image/') ? (
                      <img src={attachment.data} alt="preview" className="w-8 h-8 object-cover rounded" />
                    ) : (
                      <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    )}
                    <span className="truncate max-w-[200px] font-medium">{attachment.filename}</span>
                    <span className="text-xs text-gray-500">({Math.round(attachment.size / 1024)} KB)</span>
                  </div>
                  <button onClick={() => setAttachment(null)} className="text-gray-500 hover:text-red-400 p-1 bg-white/5 rounded-full transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              )}
              <div className="flex items-center bg-[#0d1117] border border-gray-700 rounded-xl p-2 shadow-inner focus-within:border-[#58a6ff] transition-colors">
                {/* Transfer Crypto Button (ADAMANT Style) */}
                <button
                  onClick={() => setShowTransferModal(true)}
                  disabled={activeContact.isAi}
                  className="p-2 text-gray-400 hover:text-green-400 transition-colors disabled:opacity-30 disabled:hover:text-gray-400"
                  title="Send Crypto in Chat"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={activeContact.isAi}
                  className="p-2 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-30 disabled:hover:text-gray-400 ml-1"
                  title="Attach File (Max 1MB)"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>

                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  className="flex-1 bg-transparent outline-none px-3 text-gray-200 text-sm placeholder-gray-500 ml-2"
                  placeholder={`Message ${activeContact.name}...`}
                />

                <button
                  onClick={() => handleSend()}
                  disabled={isAiTyping || !input.trim()}
                  className="bg-[#58a6ff] hover:bg-[#1f6feb] text-white p-2.5 rounded-lg transition-colors flex items-center justify-center shadow-lg disabled:opacity-50 ml-2"
                >
                  <svg
                    className="w-4 h-4 ml-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-[#161b22] border border-gray-700 flex items-center justify-center mb-6 shadow-xl">
              <svg
                className="w-10 h-10 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Krypton Secure Messenger</h3>
            <p className="text-sm max-w-md">
              End-to-end encrypted messaging and crypto transfers, powered by the decentralized web.
              Select a contact to begin.
            </p>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-[100] bg-[#161b22] border border-gray-700 rounded-xl shadow-2xl overflow-hidden w-44"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {contextMenu.isMe && (
              <button
                onClick={() => {
                  unsendMessage(contextMenu.msgId);
                  setContextMenu(null);
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center space-x-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                  />
                </svg>
                <span>Unsend</span>
              </button>
            )}
            <button
              onClick={() => {
                deleteMessage(contextMenu.msgId);
                setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 flex items-center space-x-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span>Delete for me</span>
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  messages.find((m) => m.id === contextMenu.msgId)?.decryptedPayload || ''
                );
                setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 flex items-center space-x-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Copy text</span>
            </button>
          </div>
        )}

        {/* Transfer Modal */}
        {showTransferModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-panel w-full max-w-sm rounded-2xl p-6 relative shadow-2xl border border-gray-600">
              <button
                onClick={() => setShowTransferModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
              <h3 className="text-lg font-bold text-white mb-2">
                Send encrypted transfer note to {activeContact?.name}
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                This records a private in-chat transfer note. Use the Wallet page for real on-chain
                ETH transfers.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
                    Amount
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      placeholder="0.0"
                      className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white focus:border-green-500 outline-none transition-colors"
                    />
                    <span className="absolute right-3 top-3 text-gray-500 font-bold">KRYP</span>
                  </div>
                </div>
                <button
                  onClick={() => handleSend(true, parseFloat(transferAmount) || 0, 'KRYP')}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-green-500/20 mt-4 transition-all"
                >
                  Send Encrypted Note
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
