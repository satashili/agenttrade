'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface AgentStat {
  name: string;
  pnlPct?: number;
  tradeCount?: number;
}

interface AgentStats {
  longCount: number;
  totalAgents: number;
  avgPnlPct: number;
  totalTrades: number;
  topGainer: AgentStat | null;
  topLoser: AgentStat | null;
  mostActive: AgentStat | null;
  recentCommentary: { agentName: string; title: string; postId: string; createdAt: string }[];
}

export function MarketStats() {
  const [stats, setStats] = useState<AgentStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<AgentStats>('/api/v1/market/agent-stats');
      setStats(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (!stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
        Loading stats...
      </div>
    );
  }

  const longPct = stats.totalAgents > 0 ? (stats.longCount / stats.totalAgents) * 100 : 50;
  const shortPct = 100 - longPct;

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto text-xs">
      {/* Long/Short Ratio */}
      <div>
        <div className="flex justify-between text-slate-400 mb-1">
          <span>Long {longPct.toFixed(0)}%</span>
          <span>Short {shortPct.toFixed(0)}%</span>
        </div>
        <div className="flex h-2 rounded overflow-hidden">
          <div className="bg-green-trade" style={{ width: `${longPct}%` }} />
          <div className="bg-red-trade" style={{ width: `${shortPct}%` }} />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-bg rounded p-2">
          <div className="text-slate-500">Avg PnL%</div>
          <div className={`text-sm font-medium tabular-nums ${stats.avgPnlPct >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
            {stats.avgPnlPct >= 0 ? '+' : ''}{stats.avgPnlPct.toFixed(2)}%
          </div>
        </div>
        <div className="bg-bg rounded p-2">
          <div className="text-slate-500">Total Trades</div>
          <div className="text-sm font-medium tabular-nums text-white">
            {stats.totalTrades.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Top Agents */}
      <div className="flex flex-col gap-1.5">
        {stats.topGainer && (
          <div className="flex items-center justify-between bg-bg rounded px-2 py-1.5">
            <span className="text-slate-400">Top Gainer</span>
            <Link href={`/u/${stats.topGainer.name}`} className="text-green-trade hover:underline">
              {stats.topGainer.name} ({stats.topGainer.pnlPct! >= 0 ? '+' : ''}{stats.topGainer.pnlPct}%)
            </Link>
          </div>
        )}
        {stats.topLoser && (
          <div className="flex items-center justify-between bg-bg rounded px-2 py-1.5">
            <span className="text-slate-400">Top Loser</span>
            <Link href={`/u/${stats.topLoser.name}`} className="text-red-trade hover:underline">
              {stats.topLoser.name} ({stats.topLoser.pnlPct}%)
            </Link>
          </div>
        )}
        {stats.mostActive && (
          <div className="flex items-center justify-between bg-bg rounded px-2 py-1.5">
            <span className="text-slate-400">Most Active</span>
            <Link href={`/u/${stats.mostActive.name}`} className="text-blue-400 hover:underline">
              {stats.mostActive.name} ({stats.mostActive.tradeCount} trades)
            </Link>
          </div>
        )}
      </div>

      {/* Recent Commentary */}
      {stats.recentCommentary.length > 0 && (
        <div>
          <div className="text-slate-400 mb-1.5 font-semibold">Recent Commentary</div>
          <div className="flex flex-col gap-1">
            {stats.recentCommentary.slice(0, 5).map((c) => (
              <Link
                key={c.postId}
                href={`/post/${c.postId}`}
                className="bg-bg rounded px-2 py-1.5 hover:bg-bg-card transition-colors"
              >
                <span className="text-blue-400">{c.agentName}</span>
                <span className="text-slate-400 ml-1">{c.title}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
