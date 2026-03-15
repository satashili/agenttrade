'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

interface PlatformStats {
  totalAgents: number;
  activeAgents: number;
  totalVolume: number;
  totalTrades: number;
}

interface UserPortfolio {
  account: {
    balance: number;
    totalValue: number;
    totalPnl: number;
    totalPnlPct: number;
  };
  rank?: number;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

export function StatusBar() {
  const { token, user } = useAuthStore();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<PlatformStats>('/api/v1/market/platform-stats');
      setStats(data);
    } catch { /* silent */ }
  }, []);

  const fetchPortfolio = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.get<UserPortfolio>('/api/v1/portfolio');
      setPortfolio(data);
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => {
    fetchStats();
    const interval = window.setInterval(fetchStats, 30000);
    return () => window.clearInterval(interval);
  }, [fetchStats]);

  useEffect(() => {
    if (token) {
      fetchPortfolio();
      const interval = window.setInterval(fetchPortfolio, 15000);
      return () => window.clearInterval(interval);
    } else {
      setPortfolio(null);
    }
  }, [token, fetchPortfolio]);

  return (
    <div
      className="flex items-center gap-3 px-3 border-b border-border text-[10px] shrink-0"
      style={{ height: '32px', backgroundColor: '#0B0E11' }}
    >
      {/* Arena badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="bg-accent text-black px-1.5 py-px rounded text-[9px] font-bold tracking-wide">ARENA</span>
        {stats && (
          <span className="text-slate-400 tabular-nums">{stats.totalAgents} agents</span>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-3.5 bg-border" />

      {/* Platform metrics */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Volume:</span>
          <span className="text-slate-300 tabular-nums font-medium">
            ${stats ? formatCompact(stats.totalVolume) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Active:</span>
          <span className="text-slate-300 tabular-nums font-medium">
            {stats ? stats.activeAgents : '—'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Trades:</span>
          <span className="text-slate-300 tabular-nums font-medium">
            {stats ? formatCompact(stats.totalTrades) : '—'}
          </span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User info (when logged in) */}
      {token && user && (
        <div className="flex items-center gap-3">
          <div className="w-px h-3.5 bg-border" />
          <span className="text-accent font-medium truncate max-w-[120px]">
            {user.displayName || user.name}
          </span>
          {portfolio && (
            <>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Value:</span>
                <span className="text-slate-300 tabular-nums font-medium">
                  ${formatCompact(portfolio.account.totalValue)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">PnL:</span>
                <span className={`tabular-nums font-medium ${portfolio.account.totalPnlPct >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
                  {portfolio.account.totalPnlPct >= 0 ? '+' : ''}{portfolio.account.totalPnlPct.toFixed(2)}%
                </span>
              </div>
              {portfolio.rank && (
                <div className="flex items-center gap-1">
                  <span className="text-slate-500">Rank:</span>
                  <span className="text-yellow-400 tabular-nums font-medium">#{portfolio.rank}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
