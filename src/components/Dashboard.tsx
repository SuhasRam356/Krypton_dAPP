"use client";

import { useState, useEffect, useMemo } from 'react';
import { useKryptonStore } from '@/store/useKryptonStore';
import { onPeerEvent, getPeers } from '@/crypto/network';
import {
  computeDashboardStats,
  getTopContacts,
  type PeerEvent,
  type DashboardStats
} from '@/store/dashboardStats';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ─── Palette ───
const COLORS = {
  blue: '#58a6ff',
  green: '#3fb950',
  red: '#f87171',
  purple: '#d2a8ff',
  yellow: '#f2cc60',
  cyan: '#56d4dd',
  orange: '#f0883e',
  darkBg: '#0d1117',
  cardBg: 'rgba(22, 27, 34, 0.6)',
  border: 'rgba(48, 54, 61, 0.5)',
};

const PIE_COLORS = [COLORS.blue, COLORS.green, COLORS.purple, COLORS.yellow, COLORS.cyan];

// ─── Small stat card ───
function StatCard({ label, value, icon, color = COLORS.blue }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) {
  return (
    <div className="glass-panel rounded-xl p-5 flex items-center space-x-4 shadow-lg">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: color + '18', border: `1px solid ${color}30` }}>
        <div style={{ color }}>{icon}</div>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-0.5">{label}</p>
        <p className="text-2xl font-black text-white">{value}</p>
      </div>
    </div>
  );
}

// ─── Section header ───
function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center space-x-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-[#58a6ff]/10 border border-[#58a6ff]/20 flex items-center justify-center text-[#58a6ff]">
        {icon}
      </div>
      <h2 className="text-lg font-bold text-white tracking-tight">{title}</h2>
    </div>
  );
}

// ─── Custom recharts tooltip ───
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161b22] border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-bold" style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════
// Main Dashboard Component
// ════════════════════════════════════════════
export default function Dashboard() {
  const { messages, contacts, keys, walletState } = useKryptonStore();
  const [peerEvents, setPeerEvents] = useState<PeerEvent[]>([]);
  const [activePeers, setActivePeers] = useState<Map<string, 'connected' | 'disconnected'>>(new Map());
  const [identityCreatedAt] = useState(() => Date.now()); // approximation

  // Subscribe to Gun peer events
  useEffect(() => {
    const unsub = onPeerEvent((evt) => {
      setPeerEvents(prev => [...prev, evt]);
      setActivePeers(prev => {
        const next = new Map(prev);
        next.set(evt.url, evt.status);
        return next;
      });
    });
    return unsub;
  }, []);

  // Compute stats
  const stats: DashboardStats = useMemo(
    () => computeDashboardStats(messages, contacts, keys, peerEvents, identityCreatedAt),
    [messages, contacts, keys, peerEvents, identityCreatedAt]
  );

  const topContacts = useMemo(
    () => getTopContacts(messages, contacts, keys?.kryptonId || ''),
    [messages, contacts, keys]
  );

  // Peer count over time (for area chart)
  const peerCountOverTime = useMemo(() => {
    const counts: { time: string; peers: number }[] = [];
    let current = 0;
    for (const evt of peerEvents) {
      current += evt.status === 'connected' ? 1 : -1;
      if (current < 0) current = 0;
      counts.push({ time: new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), peers: current });
    }
    if (counts.length === 0) counts.push({ time: 'now', peers: 0 });
    return counts;
  }, [peerEvents]);

  // Wallet pie data
  const walletPieData = useMemo(() => {
    if (!walletState) return [];
    return walletState.assets.map(a => {
      let price = 0;
      if (a.symbol === 'ETH') price = 3000;
      if (a.symbol === 'USDC') price = 1;
      if (a.symbol === 'KRYP') price = 0.5;
      return { name: a.symbol, value: parseFloat((a.balance * price).toFixed(2)) };
    }).filter(a => a.value > 0);
  }, [walletState]);

  // In-chat transfers
  const transfers = useMemo(
    () => messages.filter(m => m.isCryptoTransfer),
    [messages]
  );

  const connectedPeerCount = Array.from(activePeers.values()).filter(s => s === 'connected').length;
  const lastSync = stats.networkStats.lastSyncTimestamp
    ? `${Math.round((Date.now() - stats.networkStats.lastSyncTimestamp) / 1000)}s ago`
    : 'N/A';

  const identityAgeMs = Date.now() - identityCreatedAt;
  const identityAge = identityAgeMs < 60000 ? `${Math.round(identityAgeMs / 1000)}s`
    : identityAgeMs < 3600000 ? `${Math.round(identityAgeMs / 60000)}m`
    : `${Math.round(identityAgeMs / 3600000)}h`;

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto p-6 space-y-8 overflow-y-auto">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Real-time P2P network, messaging analytics, portfolio overview, and security posture.</p>
      </div>

      {/* ═══════ Top stat cards ═══════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Peers" value={connectedPeerCount} color={COLORS.green} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        } />
        <StatCard label="Messages Relayed" value={stats.networkStats.messagesRelayed} color={COLORS.blue} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        } />
        <StatCard label="Last Sync" value={lastSync} color={COLORS.cyan} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        } />
        <StatCard label="Contacts" value={contacts.filter(c => !c.isAi).length} color={COLORS.purple} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        } />
      </div>

      {/* ═══════ Section 1: P2P Network Health ═══════ */}
      <div className="glass-panel rounded-2xl p-6 shadow-lg">
        <SectionHeader title="P2P Network Health" icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        } />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Peer status indicators */}
          <div className="space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Relay Peers</p>
            {getPeers().map(url => {
              const status = activePeers.get(url) || 'disconnected';
              return (
                <div key={url} className="flex items-center space-x-3 bg-black/20 rounded-lg p-3 border border-gray-800">
                  <span className={`w-3 h-3 rounded-full ${status === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(248,113,113,0.6)]'}`} />
                  <span className="text-sm text-gray-300 font-mono truncate flex-1">{url}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${status === 'connected' ? 'text-green-400' : 'text-red-400'}`}>{status}</span>
                </div>
              );
            })}
          </div>

          {/* Active peer count over time */}
          <div className="md:col-span-2">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Active Peer Count Over Time</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={peerCountOverTime}>
                  <defs>
                    <linearGradient id="peerGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="time" tick={{ fill: '#8b949e', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="peers" stroke={COLORS.green} fill="url(#peerGrad)" strokeWidth={2} name="Peers" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ Section 2: Messaging Analytics ═══════ */}
      <div className="glass-panel rounded-2xl p-6 shadow-lg">
        <SectionHeader title="Messaging Analytics" icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        } />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Message volume over time */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Message Volume (Sent vs Received)</p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.messageDayBuckets.length > 0 ? stats.messageDayBuckets : [{ date: 'No data', sent: 0, received: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
                  <Bar dataKey="sent" fill={COLORS.blue} name="Sent" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="received" fill={COLORS.green} name="Received" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Most active contacts */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Most Active Contacts</p>
            {topContacts.length === 0 ? (
              <div className="flex items-center justify-center h-52 text-gray-600 text-sm">No messages yet</div>
            ) : (
              <div className="space-y-2">
                {topContacts.map((tc, i) => {
                  const maxCount = topContacts[0]?.messageCount || 1;
                  const pct = Math.round((tc.messageCount / maxCount) * 100);
                  return (
                    <div key={tc.contactId} className="flex items-center space-x-3">
                      <span className="text-xs text-gray-600 w-4 text-right font-bold">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm text-gray-300 truncate">{tc.contactName}</span>
                          <span className="text-xs text-gray-500 font-mono">{tc.messageCount} msgs</span>
                        </div>
                        <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Delivery + Overhead stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-800">
          <div className="text-center">
            <p className="text-2xl font-black text-white">{stats.deliverySuccess}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Delivered</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-red-400">{stats.deliveryFailed}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-yellow-400">{stats.avgCiphertextOverhead.toFixed(1)}x</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">E2EE Overhead</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-white">{messages.length}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Total Messages</p>
          </div>
        </div>
      </div>

      {/* ═══════ Section 3: Wallet / Portfolio Analytics ═══════ */}
      <div className="glass-panel rounded-2xl p-6 shadow-lg">
        <SectionHeader title="Portfolio Analytics" icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
        } />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Allocation donut */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Asset Allocation (USD)</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={walletPieData.length > 0 ? walletPieData : [{ name: 'Empty', value: 1 }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {(walletPieData.length > 0 ? walletPieData : [{ name: 'Empty', value: 1 }]).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Transaction history */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">In-Chat Transfer History</p>
            {transfers.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-gray-600 text-sm">No in-chat transfers yet</div>
            ) : (
              <div className="overflow-y-auto max-h-56 space-y-2">
                {transfers.map(tx => {
                  const isMe = keys && tx.sender === keys.kryptonId;
                  const otherName = contacts.find(c => c.id === (isMe ? tx.recipient : tx.sender))?.name || 'Unknown';
                  return (
                    <div key={tx.id} className="flex items-center justify-between bg-black/20 rounded-lg p-3 border border-gray-800">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isMe ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMe ? "M5 10l7-7m0 0l7 7m-7-7v18" : "M19 14l-7 7m0 0l-7-7m7 7V3"} /></svg>
                        </div>
                        <div>
                          <p className="text-sm text-gray-200">{isMe ? 'Sent to' : 'Received from'} <span className="font-bold">{otherName}</span></p>
                          <p className="text-[10px] text-gray-500">{new Date(tx.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                      <span className={`font-bold ${isMe ? 'text-red-400' : 'text-green-400'}`}>
                        {isMe ? '-' : '+'}{tx.transferAmount} {tx.transferSymbol}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════ Section 4: Security / Crypto Stats ═══════ */}
      <div className="glass-panel rounded-2xl p-6 shadow-lg">
        <SectionHeader title="Security & Cryptography" icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        } />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-black/20 rounded-xl p-5 border border-gray-800 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">Key Type</p>
            <p className="text-lg font-black text-[#d2a8ff]">Curve25519</p>
            <p className="text-[10px] text-gray-600 mt-1">NaCl box (XSalsa20-Poly1305)</p>
          </div>
          <div className="bg-black/20 rounded-xl p-5 border border-gray-800 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">Identity Age</p>
            <p className="text-lg font-black text-white">{identityAge}</p>
            <p className="text-[10px] text-gray-600 mt-1">Since generation</p>
          </div>
          <div className="bg-black/20 rounded-xl p-5 border border-gray-800 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">E2EE Coverage</p>
            <p className="text-lg font-black text-green-400">{stats.encryptedRatio}%</p>
            <p className="text-[10px] text-gray-600 mt-1">All messages encrypted</p>
          </div>
          <div className="bg-black/20 rounded-xl p-5 border border-gray-800 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">Pairing Failures</p>
            <p className="text-lg font-black text-green-400">{stats.pairingFailures}</p>
            <p className="text-[10px] text-gray-600 mt-1">ID = Key eliminates mismatches</p>
          </div>
        </div>

        {/* Krypton ID display */}
        {keys && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">Your Krypton ID (Public Key)</p>
            <div className="bg-black/30 rounded-lg p-3 border border-gray-800 font-mono text-xs text-gray-400 break-all select-all">
              {keys.kryptonId}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ Section 5: Contact Growth ═══════ */}
      <div className="glass-panel rounded-2xl p-6 shadow-lg">
        <SectionHeader title="Identity & Contact Growth" icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
        } />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact list summary */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Current Contacts</p>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {contacts.filter(c => !c.isAi).length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-600 text-sm">No contacts added yet</div>
              ) : (
                contacts.filter(c => !c.isAi).map(contact => (
                  <div key={contact.id} className="flex items-center space-x-3 bg-black/20 rounded-lg p-3 border border-gray-800">
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-tr ${contact.avatarColor || 'from-blue-500 to-cyan-500'} flex items-center justify-center`}>
                      <span className="text-xs font-bold text-white">{contact.name.charAt(0)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 font-bold truncate">{contact.name}</p>
                      <p className="text-[10px] text-gray-600 font-mono truncate">{contact.id.slice(0, 12)}...{contact.id.slice(-6)}</p>
                    </div>
                    <span className="text-[10px] text-green-400 font-bold uppercase">Verified</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Growth chart */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Contact Growth</p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.contactGrowth.length > 0 ? stats.contactGrowth : [{ date: 'Now', count: 0 }]}>
                  <defs>
                    <linearGradient id="contactGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="count" stroke={COLORS.purple} fill="url(#contactGrad)" strokeWidth={2} name="Contacts" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="h-8" /> {/* Bottom spacer */}
    </div>
  );
}
