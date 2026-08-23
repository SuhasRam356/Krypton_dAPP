"use client";

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { KryptonMessage, Contact } from '@/types';
import { encryptForContact } from '@/crypto/encryption';
import { fromHex } from '@/crypto/keys';
import { useKryptonStore } from '@/store/useKryptonStore';

export default function ChatWindow() {
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get('contactId');
  
  const { messages, addMessage, keys, generateKeys, contacts } = useKryptonStore();
  const [activeContactId, setActiveContactId] = useState<string | null>(initialContactId || (contacts && contacts.length > 0 ? contacts[0]?.id || null : null));
  
  const [input, setInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Ensure keys exist
  useEffect(() => {
    if (!keys) generateKeys();
  }, [keys, generateKeys]);

  const activeContact = contacts.find(c => c.id === activeContactId);
  const activeMessages = messages.filter(m => 
    (m.sender === activeContactId && m.recipient === keys?.kryptonId) || 
    (m.sender === keys?.kryptonId && m.recipient === activeContactId)
  );

  const handleSend = async (isCryptoTransfer = false, amount = 0, symbol = "KRYP") => {
    if ((!input.trim() && !isCryptoTransfer) || !keys || !activeContact) return;
    
    const userText = isCryptoTransfer ? `Transferred ${amount} ${symbol}` : input;
    setInput('');
    if (showTransferModal) setShowTransferModal(false);
    
    // Encrypt the payload using the contact's Krypton ID, which IS their public key
    // (for AI we mock it with our own key since there's no real AI identity).
    let targetPubKey: Uint8Array;
    if (activeContact.isAi) {
      targetPubKey = keys.messagingPublicKey;
    } else {
      try {
        targetPubKey = fromHex(activeContact.id);
      } catch (err) {
        alert("Invalid Krypton ID for this contact!");
        return;
      }
    }

    const ciphertext = await encryptForContact(
      userText,
      keys.messagingPrivateKey,
      targetPubKey
    );

    const newMsg: KryptonMessage = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      sender: keys.kryptonId, 
      recipient: activeContact.id,
      type: 'ONION_ROUTED',
      encryptedPayload: ciphertext,
      decryptedPayload: userText,
      metadataStripped: true,
      routePath: ['node-alpha', 'node-beta', 'node-gamma'],
      isCryptoTransfer,
      transferAmount: amount,
      transferSymbol: symbol
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
            systemPrompt: "You are Krypton AI, a helpful, deeply knowledgeable cryptocurrency and cryptography assistant embedded in an end-to-end encrypted messenger. Keep answers concise."
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const aiCiphertext = await encryptForContact(
            data.result,
            keys.messagingPrivateKey, // Mock signing
            keys.messagingPublicKey
          );
          
          const aiMsg: KryptonMessage = {
            id: (Date.now() + 1).toString(),
            timestamp: Date.now() + 1000,
            sender: activeContact.id, 
            recipient: keys.kryptonId,
            type: 'ONION_ROUTED',
            encryptedPayload: aiCiphertext,
            decryptedPayload: data.result,
            metadataStripped: true,
            routePath: ['ai-node-1', 'ai-node-2']
          };
          addMessage(aiMsg);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsAiTyping(false);
      }
    }
  };

  return (
    <div className="flex h-full w-full max-w-7xl mx-auto p-4 gap-4">
      
      {/* Sidebar: Contacts List */}
      <div className="w-80 glass-panel rounded-xl flex flex-col overflow-hidden shadow-2xl border-[rgba(88,166,255,0.05)]">
        <div className="p-4 border-b border-[rgba(48,54,61,0.5)] bg-[rgba(22,27,34,0.8)]">
          <h2 className="font-bold text-gray-100 text-lg">Chats</h2>
          <div className="mt-3 relative">
            <svg className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" placeholder="Search contacts..." className="w-full bg-[#0d1117] border border-gray-700 rounded-full pl-9 pr-4 py-2 text-sm text-gray-200 outline-none focus:border-[#58a6ff] transition-colors" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map(contact => {
            const contactMessages = messages.filter(m => 
              (m.sender === contact.id && m.recipient === keys?.kryptonId) || 
              (m.sender === keys?.kryptonId && m.recipient === contact.id)
            );
            const lastMessage = contactMessages[contactMessages.length - 1];
            const displayTime = lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

            return (
              <div 
                key={contact.id} 
                onClick={() => setActiveContactId(contact.id)}
                className={`p-4 border-b border-[rgba(48,54,61,0.5)] flex items-center cursor-pointer transition-colors ${activeContactId === contact.id ? 'bg-[rgba(88,166,255,0.1)] border-l-2 border-l-[#58a6ff]' : 'hover:bg-[rgba(255,255,255,0.02)] border-l-2 border-l-transparent'}`}
              >
                <div className={`w-12 h-12 rounded-full bg-gradient-to-tr ${contact.avatarColor} flex items-center justify-center shadow-lg flex-shrink-0`}>
                  {contact.isAi ? <span className="text-xl">🤖</span> : <span className="font-bold text-white">{contact.name.charAt(0)}</span>}
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
                <div className={`w-10 h-10 rounded-full bg-gradient-to-tr ${activeContact.avatarColor} shadow-lg flex items-center justify-center`}>
                   {activeContact.isAi ? <span className="text-lg">🤖</span> : <span className="font-bold text-white text-sm">{activeContact.name.charAt(0)}</span>}
                </div>
                <div>
                  <h3 className="font-bold text-gray-100">{activeContact.name}</h3>
                  <p className="text-xs text-green-400 flex items-center">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse"></span>
                    E2E Encrypted (Onion Routed)
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button title="Disappearing Messages" className="text-purple-400 hover:text-purple-300 transition-colors bg-purple-500/10 p-2 rounded-full">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <button title="Contact Info" className="text-gray-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              </div>
            </div>

            {/* Message List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex justify-center my-6">
                <div className="bg-[#161b22]/80 border border-yellow-500/30 px-4 py-2 rounded-xl text-center max-w-sm">
                  <p className="text-xs text-yellow-500/80 mb-1 font-semibold flex items-center justify-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    End-to-End Encrypted Session
                  </p>
                  <p className="text-[10px] text-gray-400">Messages and transfers to this chat are secured with Curve25519 and routed through the decentralized network.</p>
                </div>
              </div>

              {activeMessages.map((msg) => {
                const isMe = keys && msg.sender === keys.kryptonId;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`${isMe ? 'bg-gradient-to-br from-[#58a6ff] to-[#1f6feb] text-white rounded-tr-none' : 'bg-[#21262d] border border-[rgba(48,54,61,0.5)] text-gray-200 rounded-tl-none'} rounded-2xl p-1 max-w-[75%] shadow-lg`}>
                      
                      {/* In-chat Crypto Transfer UI */}
                      {msg.isCryptoTransfer ? (
                        <div className="m-1 rounded-xl bg-black/20 p-4 border border-white/10 w-64">
                          <div className="flex justify-between items-center mb-3">
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wider">{isMe ? 'Sent' : 'Received'}</span>
                          </div>
                          <h4 className="text-2xl font-black mb-1">{msg.transferAmount} <span className="text-sm font-medium">{msg.transferSymbol}</span></h4>
                          <p className="text-[10px] opacity-70 font-mono mt-2 pt-2 border-t border-white/10">Tx: 0x...{msg.type === 'ONION_ROUTED' ? msg.encryptedPayload.slice(0,8) : msg.payload.slice(0,8)}</p>
                        </div>
                      ) : (
                        <div className="px-4 py-2 break-words">
                          <p className="text-[9px] font-mono opacity-40 mb-1 border-b border-white/10 pb-1 flex items-center">
                             <svg className="w-3 h-3 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                             Encrypted Hash: {msg.type === 'ONION_ROUTED' ? msg.encryptedPayload.slice(0, 16) : msg.payload.slice(0, 16)}...
                          </p>
                          <p className="opacity-95 leading-relaxed whitespace-pre-wrap text-sm">{msg.decryptedPayload}</p>
                        </div>
                      )}

                      <div className={`flex items-center space-x-1 px-3 pb-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-[10px] opacity-60 font-medium">{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        {isMe && (
                           <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
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
                     <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                     <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                   </div>
                 </div>
               </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-[rgba(48,54,61,0.5)] bg-[rgba(22,27,34,0.6)]">
              <div className="flex items-center bg-[#0d1117] border border-gray-700 rounded-xl p-2 shadow-inner focus-within:border-[#58a6ff] transition-colors">
                
                {/* Transfer Crypto Button (ADAMANT Style) */}
                <button 
                  onClick={() => setShowTransferModal(true)}
                  disabled={activeContact.isAi}
                  className="p-2 text-gray-400 hover:text-green-400 transition-colors disabled:opacity-30 disabled:hover:text-gray-400"
                  title="Send Crypto in Chat"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>

                <input 
                  type="text" 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  className="flex-1 bg-transparent outline-none px-3 text-gray-200 text-sm placeholder-gray-500"
                  placeholder={`Message ${activeContact.name}...`}
                />
                
                <button 
                  onClick={() => handleSend()}
                  disabled={isAiTyping || !input.trim()}
                  className="bg-[#58a6ff] hover:bg-[#1f6feb] text-white p-2.5 rounded-lg transition-colors flex items-center justify-center shadow-lg disabled:opacity-50 ml-2"
                >
                  <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8 text-center">
             <div className="w-20 h-20 rounded-full bg-[#161b22] border border-gray-700 flex items-center justify-center mb-6 shadow-xl">
               <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
             </div>
             <h3 className="text-xl font-bold text-white mb-2">Krypton Secure Messenger</h3>
             <p className="text-sm max-w-md">End-to-end encrypted messaging and crypto transfers, powered by the decentralized web. Select a contact to begin.</p>
          </div>
        )}

        {/* Transfer Modal */}
        {showTransferModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-panel w-full max-w-sm rounded-2xl p-6 relative shadow-2xl border border-gray-600">
              <button onClick={() => setShowTransferModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <h3 className="text-lg font-bold text-white mb-4">Send Crypto to {activeContact?.name}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Amount</label>
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
                  onClick={() => handleSend(true, parseFloat(transferAmount) || 0, "KRYP")}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-green-500/20 mt-4 transition-all"
                >
                  Send & Message
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
