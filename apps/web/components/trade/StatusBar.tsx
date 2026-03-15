'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

interface PlatformStats {
  agentCount: number;
  totalTrades: number;
  totalVolume: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

export function StatusBar() {
  const { token, user } = useAuthStore();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [pnl, setPnl] = useState<{ totalValue: number; totalPnlPct: number } | null>(null);

  const fetchStats = useCallback(async () => {
    try { setStats(await api.get('/api/v1/market/platform-stats')); } catch {}
  }, []);

  const fetchPnl = useCallback(async () => {
    if (!token) return;
    try {
      const p: any = await api.get('/api/v1/portfolio');
      setPnl({ totalValue: p.totalValue, totalPnlPct: p.totalPnlPct });
    } catch {}
  }, [token]);

  useEffect(() => { fetchStats(); const i = setInterval(fetchStats, 30_000); return () => clearInterval(i); }, [fetchStats]);
  useEffect(() => {
    if (token) { fetchPnl(); const i = setInterval(fetchPnl, 15_000); return () => clearInterval(i); }
    else setPnl(null);
  }, [token, fetchPnl]);

  return (
    <div className="flex items-center h-7 px-3 border-b border-border/60 bg-[#0B0E11] text-[10px] shrink-0 gap-4">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#0ECB81] animate-pulse" />
        <span className="text-slate-500 font-medium">LIVE</span>
        {stats && <span className="text-slate-400 tabular-nums">{stats.agentCount} agents</span>}
      </div>
      <span className="text-slate-600">|</span>
      <span className="text-slate-500">Vol <span className="text-slate-300 tabular-nums">${stats ? fmt(stats.totalVolume) : '—'}</span></span>
      <span className="text-slate-500">Trades <span className="text-slate-300 tabular-nums">{stats ? fmt(stats.totalTrades) : '—'}</span></span>
      <div className="flex-1" />
      {token && user && pnl && (
        <div className="flex items-center gap-3">
          <span className="text-[#F0B90B] font-medium">{user.displayName || user.name}</span>
          <span className="text-slate-500">Equity <span className="text-slate-200 tabular-nums">${fmt(pnl.totalValue)}</span></span>
          <span className={`tabular-nums font-medium ${pnl.totalPnlPct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
            {pnl.totalPnlPct >= 0 ? '+' : ''}{pnl.totalPnlPct.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}
