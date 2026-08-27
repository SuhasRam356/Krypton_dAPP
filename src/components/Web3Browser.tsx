"use client";

import { useState, FormEvent, MouseEvent } from 'react';

type Tab = {
  id: string;
  title: string;
  url: string;
  inputUrl: string;
  isLoading: boolean;
  shieldsUp: boolean;
  trackersBlocked: number;
};

export default function Web3Browser() {
  const [tabs, setTabs] = useState<Tab[]>([{
    id: 'tab-1',
    title: 'New Tab',
    url: 'krypton://newtab',
    inputUrl: '',
    isLoading: false,
    shieldsUp: true,
    trackersBlocked: 0
  }]);
  
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [showShields, setShowShields] = useState(false);
  
  // Overall browser stats (mocked)
  const [globalStats, setGlobalStats] = useState({
    trackers: 12453,
    bandwidthMb: 342,
    timeSavedMins: 45
  });

  const activeTab = (tabs.find(t => t.id === activeTabId) || tabs[0])!;
  
  const updateTab = (id: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };
  
  const addTab = () => {
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, {
      id: newId,
      title: 'New Tab',
      url: 'krypton://newtab',
      inputUrl: '',
      isLoading: false,
      shieldsUp: true,
      trackersBlocked: 0
    }]);
    setActiveTabId(newId);
    setShowShields(false);
  };
  
  const closeTab = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setTabs(prev => {
      if (prev.length === 1) {
        return [{ ...prev[0]!, url: 'krypton://newtab', title: 'New Tab', inputUrl: '', trackersBlocked: 0 }];
      }
      const newTabs = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        const idx = prev.findIndex(t => t.id === id);
        setActiveTabId(newTabs[Math.max(0, idx - 1)]!.id);
      }
      return newTabs;
    });
  };
  
  const handleNavigate = (e?: FormEvent) => {
    if (e) e.preventDefault();
    let finalUrl = activeTab.inputUrl.trim();
    if (!finalUrl) return;
    
    if (finalUrl.toLowerCase() === 'krypton://newtab') {
      updateTab(activeTabId, { url: finalUrl, title: 'New Tab', isLoading: false, trackersBlocked: 0 });
      return;
    }
    
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }
    
    // Simulate finding trackers
    const mockTrackers = Math.floor(Math.random() * 30) + 5;
    
    updateTab(activeTabId, { 
      url: finalUrl, 
      inputUrl: finalUrl, 
      title: 'Loading...',
      isLoading: true,
      trackersBlocked: mockTrackers
    });
    setShowShields(false);
  };

  const handleIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    updateTab(activeTabId, { isLoading: false });
    // Try to get actual hostname if possible, fallback to URL hostname
    try {
      const parsed = new URL(activeTab.url);
      updateTab(activeTabId, { title: parsed.hostname });
      
      // Update global stats
      setGlobalStats(prev => ({
        trackers: prev.trackers + activeTab.trackersBlocked,
        bandwidthMb: prev.bandwidthMb + (activeTab.trackersBlocked * 0.1),
        timeSavedMins: prev.timeSavedMins + (activeTab.trackersBlocked * 0.05)
      }));
    } catch {
      updateTab(activeTabId, { title: activeTab.url });
    }
  };

  const toggleShields = () => {
    updateTab(activeTabId, { shieldsUp: !activeTab.shieldsUp });
  };

  return (
    <div className="flex flex-col h-full w-full mx-auto space-y-0 bg-[#0d1117] rounded-xl overflow-hidden shadow-2xl border border-[rgba(88,166,255,0.1)]">
      
      {/* Tabs Bar */}
      <div className="flex items-end bg-[#05070a] px-2 pt-2 h-12 overflow-x-auto hide-scrollbar">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`group flex items-center min-w-[150px] max-w-[240px] px-3 py-1.5 rounded-t-lg cursor-pointer border-r border-t border-l ${
              activeTabId === tab.id 
                ? 'bg-[#161b22] border-[rgba(88,166,255,0.2)] text-white z-10' 
                : 'bg-transparent border-transparent text-gray-500 hover:bg-[#161b22]/50 hover:text-gray-300'
            }`}
          >
            {/* Favicon Placeholder */}
            {tab.isLoading ? (
              <svg className="animate-spin h-3 w-3 mr-2 text-[#58a6ff]" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            ) : tab.url === 'krypton://newtab' ? (
              <span className="text-[10px] mr-2">🪐</span>
            ) : (
              <div className="w-3 h-3 rounded bg-white/10 mr-2 flex items-center justify-center text-[8px] font-bold">W</div>
            )}
            
            <span className="flex-1 truncate text-xs font-medium mr-2 select-none">
              {tab.title}
            </span>
            
            <button 
              onClick={(e) => closeTab(e, tab.id)}
              className={`p-0.5 rounded hover:bg-white/10 transition-colors ${activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
        <button 
          onClick={addTab}
          className="p-1.5 ml-1 mb-1 rounded-full text-gray-400 hover:text-white hover:bg-[#161b22] transition-colors"
          title="New Tab"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>

      {/* Browser Controls */}
      <div className="bg-[#161b22] p-2 flex items-center space-x-3 border-b border-[rgba(88,166,255,0.1)] z-20">
        <div className="flex space-x-1 text-gray-400">
          <button className="p-1.5 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Back">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button className="p-1.5 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Forward">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
          <button onClick={() => handleNavigate()} className="p-1.5 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Reload">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>

        {/* Address Bar */}
        <div className="flex-1 relative flex items-center">
          <form onSubmit={handleNavigate} className="w-full flex items-center bg-[#0d1117] border border-gray-700 rounded-full pl-2 pr-4 py-1.5 focus-within:border-[#58a6ff] transition-colors relative">
            
            {/* Shields/Security Indicator */}
            <div className="relative">
              <button 
                type="button"
                onClick={() => setShowShields(!showShields)}
                className={`flex items-center justify-center p-1 rounded-full mr-2 transition-colors ${
                  activeTab.url === 'krypton://newtab' 
                    ? 'text-gray-500 cursor-default' 
                    : activeTab.shieldsUp ? 'text-[#f87171] hover:bg-[#f87171]/10' : 'text-gray-500 hover:bg-white/10'
                }`}
                disabled={activeTab.url === 'krypton://newtab'}
              >
                {activeTab.url === 'krypton://newtab' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" /></svg>
                ) : activeTab.shieldsUp ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                )}
              </button>

              {/* Shields Dropdown UI */}
              {showShields && activeTab.url !== 'krypton://newtab' && (
                <div className="absolute top-full left-0 mt-3 w-72 bg-[#161b22] border border-[rgba(88,166,255,0.2)] rounded-xl shadow-2xl p-4 z-50">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-white flex items-center">
                      <svg className={`w-5 h-5 mr-2 ${activeTab.shieldsUp ? 'text-[#f87171]' : 'text-gray-500'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                      Shields are {activeTab.shieldsUp ? 'UP' : 'DOWN'}
                    </h3>
                    <button 
                      type="button"
                      onClick={toggleShields}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${activeTab.shieldsUp ? 'bg-[#f87171]' : 'bg-gray-600'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${activeTab.shieldsUp ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mb-4 border-b border-gray-700 pb-4">
                    {activeTab.shieldsUp ? 'Krypton is blocking trackers and scripts on this site to protect your privacy.' : 'You are unprotected on this site.'}
                  </p>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-300">Trackers Blocked</span>
                    <span className="font-bold text-white">{activeTab.shieldsUp ? activeTab.trackersBlocked : 0}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Lock Icon */}
            {activeTab.url.startsWith('https://') && (
              <svg className="w-3.5 h-3.5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            )}

            <input 
              type="text" 
              value={activeTab.inputUrl}
              onChange={(e) => updateTab(activeTabId, { inputUrl: e.target.value })}
              className="flex-1 bg-transparent outline-none text-gray-200 text-sm"
              placeholder="Search or enter Web3 address..."
              onFocus={() => setShowShields(false)}
            />
          </form>
        </div>

        {/* Web3 Connected Badge */}
        <div className="flex items-center bg-[rgba(34,197,94,0.1)] text-green-400 border border-green-500/20 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-green-400 mr-2 animate-pulse"></span>
          Web3 Connected
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 bg-white relative w-full h-full overflow-hidden">
        {activeTab.url === 'krypton://newtab' ? (
          // Start Page
          <div className="absolute inset-0 bg-[#0d1117] flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="w-full max-w-3xl flex flex-col items-center">
              {/* Krypton Logo */}
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-[#58a6ff] to-[#1f6feb] flex items-center justify-center shadow-[0_0_40px_rgba(88,166,255,0.3)] mb-8">
                <span className="text-4xl font-black text-white">K</span>
              </div>
              
              <h1 className="text-4xl font-bold text-white mb-12">Private & Decentralized</h1>
              
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-12">
                <div className="bg-[#161b22] border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center shadow-lg">
                  <span className="text-4xl font-black text-[#f87171] mb-2">{globalStats.trackers.toLocaleString()}</span>
                  <span className="text-sm text-gray-400 uppercase tracking-widest font-bold">Trackers Blocked</span>
                </div>
                <div className="bg-[#161b22] border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center shadow-lg">
                  <span className="text-4xl font-black text-[#60a5fa] mb-2">{globalStats.bandwidthMb.toFixed(1)} <span className="text-lg">MB</span></span>
                  <span className="text-sm text-gray-400 uppercase tracking-widest font-bold">Bandwidth Saved</span>
                </div>
                <div className="bg-[#161b22] border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center shadow-lg">
                  <span className="text-4xl font-black text-[#34d399] mb-2">{globalStats.timeSavedMins.toFixed(1)} <span className="text-lg">m</span></span>
                  <span className="text-sm text-gray-400 uppercase tracking-widest font-bold">Time Saved</span>
                </div>
              </div>

              {/* Quick Links */}
              <div className="w-full grid grid-cols-4 gap-4 max-w-xl">
                {['DEX', 'NFTs', 'Social', 'DAOs'].map((cat, i) => (
                  <button key={i} className="bg-[#161b22] hover:bg-[#21262d] border border-gray-800 hover:border-gray-700 rounded-xl p-4 flex flex-col items-center transition-colors">
                    <div className="w-10 h-10 rounded-full bg-white/5 mb-3"></div>
                    <span className="text-xs text-gray-400 font-medium">{cat}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Iframe
          <>
            <iframe 
              src={activeTab.url}
              onLoad={handleIframeLoad}
              className={`w-full h-full border-none transition-opacity duration-300 ${activeTab.isLoading ? 'opacity-50' : 'opacity-100'}`}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              title={`Web3 Secure Browser Viewport - ${activeTab.title}`}
            />
            
            {activeTab.isLoading && (
              <div className="absolute inset-0 bg-[#0d1117]/50 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
                <div className="bg-[#161b22] border border-gray-700 p-4 rounded-xl shadow-2xl flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-[#58a6ff]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <p className="text-gray-300 font-medium">Resolving {activeTab.url} securely...</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
