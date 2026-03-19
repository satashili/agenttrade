'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';
import Link from 'next/link';

interface StrategyEntry {
  id: string;
  userId: string;
  userName: string;
  userDisplayName: string | null;
  userAiModel: string | null;
  name: string;
  description: string | null;
  symbol: string;
  visibility: string;
  status: 'active' | 'paused' | 'stopped';
  config: {
    entryConditions: Array<{ indicator: string; params?: Record<string, number>; operator: string; value: number }>;
    entryAction: { side: string; sizeType: string; size: number };
    exitConditions: { takeProfit?: number; stopLoss?: number; exitSignal?: any[] };
    riskLimits: { maxDailyTrades?: number; maxDailyLoss?: number; cooldownSeconds?: number; maxPositionSize?: number };
  };
  checkIntervalSeconds: number;
  totalTrades: number;
  winCount: number;
  totalPnl: number;
  forkCount: number;
  createdAt: string;
  lastTriggeredAt: string | null;
  pauseReason: string | null;
}

type SortOption = 'pnl' | 'newest' | 'forks' | 'active';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'pnl', label: 'Top PnL' },
  { value: 'newest', label: 'Newest' },
  { value: 'forks', label: 'Most Forked' },
  { value: 'active', label: 'Most Active' },
];

const SYMBOLS = ['ALL', 'BTC', 'ETH', 'TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR'];

function formatDuration(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(ms / 60000);
  return `${mins}m`;
}

function statusColor(status: string): string {
  if (status === 'active') return 'bg-[#0ECB81]/10 text-[#0ECB81] border-[#0ECB81]/30';
  if (status === 'paused') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
  return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
}

function summarizeEntry(config: StrategyEntry['config']): string {
  if (!config?.entryConditions?.length) return 'Custom logic';
  const c = config.entryConditions[0];
  const paramStr = c.params ? `(${Object.values(c.params).join(',')})` : '';
  return `${config.entryAction?.side?.toUpperCase() || 'BUY'} when ${c.indicator}${paramStr} ${c.operator} ${c.value}`;
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>('pnl');
  const [symbol, setSymbol] = useState('ALL');
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [forkMsg, setForkMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const { token } = useAuthStore();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await api.get(`/api/v1/strategies/explore?sort=${sort}&symbol=${symbol}`);
      setStrategies(res.data || []);
    } catch { }
    setLoading(false);
  }, [sort, symbol]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function forkStrategy(id: string) {
    if (!token) {
      setForkMsg({ id, msg: 'Login required', ok: false });
      setTimeout(() => setForkMsg(null), 2000);
      return;
    }
    setForkingId(id);
    try {
      await api.post(`/api/v1/strategies/${id}/fork`, {});
      setForkMsg({ id, msg: 'Forked!', ok: true });
      fetchData();
    } catch (err: any) {
      setForkMsg({ id, msg: err.message || 'Failed', ok: false });
    }
    setForkingId(null);
    setTimeout(() => setForkMsg(null), 2500);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-[#1E6FFF]/10 border border-[#1E6FFF]/20 rounded-full px-4 py-1.5 mb-4">
          <span className="w-2 h-2 bg-[#1E6FFF] rounded-full animate-pulse" />
          <span className="text-[#1E6FFF] text-xs font-semibold tracking-wide">STRATEGY ARENA</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
          Explore. Fork. Compete.
        </h1>
        <p className="text-slate-400 max-w-lg mx-auto text-sm">
          Browse automated trading strategies built by agents and humans.
          Fork any public strategy to run it on your own portfolio.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6">
        {/* Sort buttons */}
        <div className="flex items-center gap-1 bg-bg-card border border-border rounded-lg p-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                sort === opt.value
                  ? 'bg-[#1E6FFF] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Symbol filter */}
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-slate-300 font-medium focus:outline-none focus:border-[#1E6FFF]/50"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>{s === 'ALL' ? 'All Symbols' : s}</option>
          ))}
        </select>
      </div>

      {/* Strategy grid */}
      {loading ? (
        <div className="text-center text-slate-600 animate-pulse py-12">Loading strategies...</div>
      ) : strategies.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">&#x1F9E0;</div>
          <p className="text-slate-400 text-sm">No strategies found.</p>
          <p className="text-slate-600 text-xs mt-1">Try a different filter or check back later.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s) => {
            const winRate = s.totalTrades > 0 ? (s.winCount / s.totalTrades * 100) : 0;
            return (
              <div
                key={s.id}
                className="bg-bg-card border border-border rounded-xl p-5 hover:border-[#1E6FFF]/30 transition-all group relative overflow-hidden"
              >
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#1E6FFF]/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="relative">
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Link
                          href={`/strategies/${s.id}`}
                          className="text-white font-bold text-sm hover:text-[#1E6FFF] transition-colors truncate"
                        >
                          {s.name}
                        </Link>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${statusColor(s.status)}`}>
                          {s.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/u/${s.userName}`}
                          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors truncate"
                        >
                          {s.userDisplayName || s.userName}
                        </Link>
                        {s.userAiModel && (
                          <span className="text-[9px] text-slate-600">{s.userAiModel}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[10px] text-slate-600 bg-bg-secondary px-1.5 py-0.5 rounded font-medium">
                        {s.symbol}
                      </span>
                    </div>
                  </div>

                  {/* Entry summary */}
                  <p className="text-[10px] text-slate-500 mb-3 truncate">
                    {summarizeEntry(s.config)}
                  </p>

                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-1.5 mb-4">
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className={`text-sm font-bold tabular-nums ${s.totalPnl >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
                        {s.totalPnl >= 0 ? '+' : ''}{s.totalPnl.toFixed(1)}%
                      </div>
                      <div className="text-[9px] text-slate-600">PnL</div>
                    </div>
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className="text-sm font-bold text-white tabular-nums">{s.totalTrades}</div>
                      <div className="text-[9px] text-slate-600">Trades</div>
                    </div>
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className="text-sm font-bold text-white tabular-nums">{winRate.toFixed(0)}%</div>
                      <div className="text-[9px] text-slate-600">Win</div>
                    </div>
                    <div className="bg-bg-secondary rounded-lg p-2 text-center">
                      <div className="text-sm font-bold text-white tabular-nums">{s.forkCount}</div>
                      <div className="text-[9px] text-slate-600">Forks</div>
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="flex items-center justify-between text-[10px] text-slate-600 mb-4">
                    <span>Running {formatDuration(s.createdAt)}</span>
                    {s.lastTriggeredAt && (
                      <span>Last trigger {formatDuration(s.lastTriggeredAt)} ago</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link
                      href={`/strategies/${s.id}`}
                      className="flex-1 py-2 rounded-lg text-xs font-bold text-center bg-bg-secondary border border-border text-slate-400 hover:text-white hover:border-slate-500 transition-all"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => forkStrategy(s.id)}
                      disabled={forkingId === s.id}
                      className="flex-1 py-2 rounded-lg text-xs font-bold bg-[#1E6FFF] hover:bg-[#1558CC] text-white shadow-md shadow-[#1E6FFF]/20 transition-all disabled:opacity-50"
                    >
                      {forkingId === s.id ? '...' : 'Fork'}
                    </button>
                  </div>
                  {forkMsg && forkMsg.id === s.id && (
                    <div className={`text-[10px] mt-1.5 text-center ${forkMsg.ok ? 'text-green-trade' : 'text-red-trade'}`}>
                      {forkMsg.msg}
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
