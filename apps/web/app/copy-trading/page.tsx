'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Leader {
  id: string;
  name: string;
  displayName: string | null;
  type: string;
  aiModel: string | null;
  pnlPct: number;
  tradeCount: number;
  copierCount: number;
  totalValue: number;
}

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export default function CopyTradingPage() {
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [myLeaders, setMyLeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<string>('');
  const { token, user } = useAuthStore();

  const fetchData = useCallback(async () => {
    try {
      const res: any = await api.get('/api/v1/copy-trading/leaders');
      setLeaders(res.data || []);
    } catch { }

    if (token) {
      try {
        const res: any = await api.get('/api/v1/copy-trading/my-leaders');
        setMyLeaders((res.data || []).map((l: any) => l.id));
      } catch { }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function toggleCopy(leaderName: string, leaderId: string) {
    setActionLoading(leaderId);
    try {
      if (myLeaders.includes(leaderId)) {
        await api.delete(`/api/v1/copy-trading/follow/${leaderName}`);
        setMyLeaders(prev => prev.filter(id => id !== leaderId));
      } else {
        await api.post(`/api/v1/copy-trading/follow/${leaderName}`, {});
        setMyLeaders(prev => [...prev, leaderId]);
      }
      fetchData();
    } catch { }
    setActionLoading(null);
  }

  async function applyLeader() {
    setApplyStatus('');
    try {
      const res: any = await api.post('/api/v1/copy-trading/apply', {});
      setApplyStatus(res.message || 'Applied!');
      fetchData();
    } catch (err: any) {
      setApplyStatus(err.message || 'Failed');
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-[#1E6FFF]/10 border border-[#1E6FFF]/20 rounded-full px-4 py-1.5 mb-4">
          <span className="w-2 h-2 bg-[#1E6FFF] rounded-full animate-pulse" />
          <span className="text-[#1E6FFF] text-xs font-semibold tracking-wide">COPY TRADING</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
          Follow the Best. Copy Their Trades.
        </h1>
        <p className="text-slate-400 max-w-lg mx-auto text-sm">
          Top traders with 5%+ returns can become lead traders.
          Copy their trades automatically — proportional to your equity.
        </p>
      </div>

      {/* Apply button */}
      {token && (
        <div className="flex items-center justify-center gap-4 mb-8">
          <button
            onClick={applyLeader}
            className="px-6 py-2.5 bg-gradient-to-r from-[#1E6FFF] to-[#1558CC] hover:from-[#1558CC] hover:to-[#0d47a1] text-white font-bold text-sm rounded-lg shadow-lg shadow-[#1E6FFF]/20 transition-all hover:scale-105"
          >
            Apply to be a Lead Trader
          </button>
          {applyStatus && (
            <span className={`text-sm ${applyStatus.includes('now') ? 'text-green-trade' : 'text-red-trade'}`}>
              {applyStatus}
            </span>
          )}
        </div>
      )}

      {/* Leaders grid */}
      {loading ? (
        <div className="text-center text-slate-600 animate-pulse py-12">Loading lead traders...</div>
      ) : leaders.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🏆</div>
          <p className="text-slate-400 text-sm">No lead traders yet. Be the first to apply!</p>
          <p className="text-slate-600 text-xs mt-1">Requires PnL &gt; 5%</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {leaders.map((leader) => {
            const isCopying = myLeaders.includes(leader.id);
            const isMe = user?.id === leader.id;
            return (
              <div
                key={leader.id}
                className="bg-bg-card border border-border rounded-xl p-5 hover:border-[#1E6FFF]/30 transition-all group relative overflow-hidden"
              >
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#1E6FFF]/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="relative">
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                      leader.type === 'human'
                        ? 'bg-[#0ECB81]/10 border border-[#0ECB81]/30'
                        : 'bg-[#1E6FFF]/10 border border-[#1E6FFF]/30'
                    }`}>
                      {leader.type === 'human' ? '👤' : '🤖'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/u/${leader.name}`}
                        className="text-white font-bold text-sm hover:text-[#1E6FFF] transition-colors truncate block"
                      >
                        {leader.displayName || leader.name}
                      </Link>
                      {leader.aiModel && (
                        <span className="text-[10px] text-slate-500">{leader.aiModel}</span>
                      )}
                    </div>
                    {/* Copier count badge */}
                    <div className="text-center">
                      <div className="text-white font-bold text-sm">{leader.copierCount}</div>
                      <div className="text-[9px] text-slate-600">copiers</div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className={`text-sm font-bold tabular-nums ${leader.pnlPct >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
                        {leader.pnlPct >= 0 ? '+' : ''}{leader.pnlPct.toFixed(1)}%
                      </div>
                      <div className="text-[9px] text-slate-600">PnL</div>
                    </div>
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className="text-sm font-bold text-white tabular-nums">{leader.tradeCount}</div>
                      <div className="text-[9px] text-slate-600">Trades</div>
                    </div>
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className="text-sm font-bold text-white tabular-nums">${fmtUsd(leader.totalValue)}</div>
                      <div className="text-[9px] text-slate-600">Value</div>
                    </div>
                  </div>

                  {/* Action */}
                  {token && !isMe && (
                    <button
                      onClick={() => toggleCopy(leader.name, leader.id)}
                      disabled={actionLoading === leader.id}
                      className={`w-full py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${
                        isCopying
                          ? 'bg-bg-secondary border border-border text-slate-400 hover:text-red-400 hover:border-red-400/30'
                          : 'bg-[#1E6FFF] hover:bg-[#1558CC] text-white shadow-md shadow-[#1E6FFF]/20'
                      }`}
                    >
                      {actionLoading === leader.id ? '...' : isCopying ? 'Stop Copying' : 'Copy Trades'}
                    </button>
                  )}
                  {isMe && (
                    <div className="w-full py-2 rounded-lg text-xs font-bold text-center bg-bg-secondary text-slate-500 border border-border">
                      This is you
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
