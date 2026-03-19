'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAuthStore, useMarketStore } from '@/lib/store';
import { api } from '@/lib/api';
import Link from 'next/link';

interface StrategyPosition {
  symbol: string;
  size: number;
  avgCost: number;
}

interface StrategyDetail {
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
  allocatedCapital?: number;
  currentCash?: number;
  initialEquity?: number;
  pnlPct?: number;
  positions?: StrategyPosition[];
  logs?: Array<{ id: string; action: string; result: string; createdAt: string; details?: string }>;
}

function formatDuration(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusColor(status: string): string {
  if (status === 'active') return 'bg-[#0ECB81]/10 text-[#0ECB81] border-[#0ECB81]/30';
  if (status === 'paused') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
  return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
}

function renderEntryConditions(config: StrategyDetail['config']): string[] {
  const lines: string[] = [];
  if (config.entryConditions?.length) {
    config.entryConditions.forEach((c) => {
      const paramStr = c.params ? `(${Object.values(c.params).join(',')})` : '';
      const side = config.entryAction?.side?.toUpperCase() || 'BUY';
      lines.push(`${side} when ${c.indicator}${paramStr} ${c.operator} ${c.value}`);
    });
  }
  if (config.entryAction) {
    const a = config.entryAction;
    lines.push(`Size: ${a.size} ${a.sizeType === 'percent' ? '% of portfolio' : a.sizeType}`);
  }
  return lines;
}

function renderExitConditions(config: StrategyDetail['config']): string[] {
  const lines: string[] = [];
  const exit = config.exitConditions;
  if (!exit) return lines;
  if (exit.takeProfit != null) lines.push(`Take profit: +${exit.takeProfit}%`);
  if (exit.stopLoss != null) lines.push(`Stop loss: -${exit.stopLoss}%`);
  if (exit.exitSignal?.length) {
    exit.exitSignal.forEach((s: any) => {
      const paramStr = s.params ? `(${Object.values(s.params).join(',')})` : '';
      lines.push(`Sell when ${s.indicator}${paramStr} ${s.operator} ${s.value}`);
    });
  }
  return lines;
}

function renderRiskLimits(config: StrategyDetail['config']): string[] {
  const lines: string[] = [];
  const r = config.riskLimits;
  if (!r) return lines;
  if (r.maxDailyTrades != null) lines.push(`Max ${r.maxDailyTrades} trades/day`);
  if (r.maxDailyLoss != null) lines.push(`Max $${r.maxDailyLoss.toLocaleString()} daily loss`);
  if (r.cooldownSeconds != null) {
    const mins = r.cooldownSeconds >= 60 ? `${Math.round(r.cooldownSeconds / 60)}min` : `${r.cooldownSeconds}s`;
    lines.push(`${mins} cooldown between trades`);
  }
  if (r.maxPositionSize != null) lines.push(`Max position size: ${r.maxPositionSize}`);
  return lines;
}

export default function StrategyDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [strategy, setStrategy] = useState<StrategyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forkingId, setForkingId] = useState(false);
  const [forkFormOpen, setForkFormOpen] = useState(false);
  const [forkCapital, setForkCapital] = useState('');
  const [forkMsg, setForkMsg] = useState<{ msg: string; ok: boolean } | null>(null);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const { token, user } = useAuthStore();
  const prices = useMarketStore((s) => s.prices);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Try authenticated endpoint first (works for owner), fall back to public
      let res: any;
      if (token) {
        try {
          res = await api.get(`/api/v1/strategies/${id}`);
        } catch {
          res = await api.get(`/api/v1/strategies/explore/${id}`);
        }
      } else {
        res = await api.get(`/api/v1/strategies/explore/${id}`);
      }
      setStrategy(res.data || res);
    } catch (err: any) {
      setError(err.message || 'Failed to load strategy');
    }
    setLoading(false);
  }, [id, token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function openForkForm() {
    if (!token) {
      setForkMsg({ msg: 'Login required', ok: false });
      setTimeout(() => setForkMsg(null), 2000);
      return;
    }
    setForkFormOpen(true);
    setForkCapital('');
    setForkMsg(null);
    try {
      const p: any = await api.get('/api/v1/portfolio');
      setUserBalance(p.cashBalance || 0);
    } catch {
      setUserBalance(null);
    }
  }

  async function confirmFork() {
    const amount = parseFloat(forkCapital);
    if (!amount || amount <= 0) {
      setForkMsg({ msg: 'Enter a valid amount', ok: false });
      setTimeout(() => setForkMsg(null), 2000);
      return;
    }
    setForkingId(true);
    try {
      await api.post(`/api/v1/strategies/${id}/fork`, { allocatedCapital: amount });
      setForkMsg({ msg: 'Strategy forked to your account!', ok: true });
      setForkFormOpen(false);
      fetchData();
    } catch (err: any) {
      setForkMsg({ msg: err.message || 'Failed to fork', ok: false });
    }
    setForkingId(false);
    setTimeout(() => setForkMsg(null), 3000);
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center text-slate-600 animate-pulse">
        Loading strategy...
      </div>
    );
  }

  if (error || !strategy) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-red-trade text-sm mb-4">{error || 'Strategy not found'}</p>
        <Link href="/strategies" className="text-[#1E6FFF] text-sm hover:underline">
          Back to Strategy Arena
        </Link>
      </div>
    );
  }

  const winRate = strategy.totalTrades > 0 ? (strategy.winCount / strategy.totalTrades * 100) : 0;
  const entryLines = renderEntryConditions(strategy.config);
  const exitLines = renderExitConditions(strategy.config);
  const riskLines = renderRiskLimits(strategy.config);
  const isOwner = user?.id === strategy.userId;

  // Compute current equity from positions + cash
  const positionValue = strategy.positions?.reduce((sum, p) => {
    const currentPrice = prices[p.symbol] ?? p.avgCost;
    return sum + Math.abs(p.size) * currentPrice;
  }, 0) ?? 0;
  const currentEquity = strategy.currentCash != null ? strategy.currentCash + positionValue : null;
  const pnl = strategy.pnlPct ?? strategy.totalPnl;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link
        href="/strategies"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 mb-6 transition-colors"
      >
        <span>&larr;</span> Strategy Arena
      </Link>

      {/* Header */}
      <div className="bg-bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <h1 className="text-2xl font-black text-white">{strategy.name}</h1>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor(strategy.status)}`}>
                {strategy.status.toUpperCase()}
              </span>
            </div>
            {strategy.description && (
              <p className="text-slate-400 text-sm mb-3">{strategy.description}</p>
            )}
            <div className="flex items-center gap-2">
              <Link
                href={`/u/${strategy.userName}`}
                className="text-xs text-slate-400 hover:text-[#1E6FFF] transition-colors font-medium"
              >
                {strategy.userDisplayName || strategy.userName}
              </Link>
              {strategy.userAiModel && (
                <span className="text-[10px] text-slate-600">{strategy.userAiModel}</span>
              )}
              <span className="text-[10px] text-slate-600 bg-bg-secondary px-1.5 py-0.5 rounded font-medium">
                {strategy.symbol}
              </span>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            {/* Owner controls */}
            {isOwner && strategy.status === 'active' && (
              <button
                onClick={async () => {
                  try {
                    await api.post(`/api/v1/strategies/${id}/pause`, {});
                    fetchData();
                  } catch (err: any) { setError(err.message); }
                }}
                className="px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20 text-yellow-400 font-bold text-sm rounded-lg transition-all"
              >
                Pause
              </button>
            )}
            {isOwner && strategy.status === 'paused' && (
              <button
                onClick={async () => {
                  try {
                    await api.post(`/api/v1/strategies/${id}/resume`, {});
                    fetchData();
                  } catch (err: any) { setError(err.message); }
                }}
                className="px-4 py-2.5 bg-[#0ECB81]/10 border border-[#0ECB81]/30 hover:bg-[#0ECB81]/20 text-[#0ECB81] font-bold text-sm rounded-lg transition-all"
              >
                Resume
              </button>
            )}
            {isOwner && strategy.status !== 'stopped' && (
              <button
                onClick={async () => {
                  if (!confirm('Stop this strategy? Positions will be closed and funds returned to your account.')) return;
                  try {
                    const res: any = await api.delete(`/api/v1/strategies/${id}`);
                    setForkMsg({ msg: `Strategy stopped. $${(res.fundsReturned || 0).toLocaleString()} returned to your account.`, ok: true });
                    fetchData();
                  } catch (err: any) { setError(err.message); }
                }}
                className="px-4 py-2.5 bg-[#F6465D]/10 border border-[#F6465D]/30 hover:bg-[#F6465D]/20 text-[#F6465D] font-bold text-sm rounded-lg transition-all"
              >
                Stop
              </button>
            )}
            {/* Fork button (non-owners) */}
            {!isOwner && strategy.status !== 'stopped' && (
              <button
                onClick={openForkForm}
                disabled={forkingId}
                className="px-6 py-2.5 bg-gradient-to-r from-[#1E6FFF] to-[#1558CC] hover:from-[#1558CC] hover:to-[#0d47a1] text-white font-bold text-sm rounded-lg shadow-lg shadow-[#1E6FFF]/20 transition-all hover:scale-105 disabled:opacity-50"
              >
                {forkingId ? 'Forking...' : 'Fork Strategy'}
              </button>
            )}
          </div>
        </div>

        {/* Inline fork form */}
        {forkFormOpen && (
          <div className="mt-4 bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-2">Allocate capital for this strategy</div>
            {userBalance != null && (
              <div className="text-xs text-slate-600 mb-2">Your balance: ${userBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            )}
            <input
              type="number"
              placeholder="Amount (e.g. 10000)"
              value={forkCapital}
              onChange={(e) => setForkCapital(e.target.value)}
              className="w-full max-w-xs bg-bg-card border border-border rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#1E6FFF]/50 mb-3 tabular-nums"
            />
            <div className="flex gap-2">
              <button
                onClick={confirmFork}
                disabled={forkingId}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-[#1E6FFF] hover:bg-[#1558CC] text-white transition-all disabled:opacity-50"
              >
                {forkingId ? 'Forking...' : 'Confirm Fork'}
              </button>
              <button
                onClick={() => { setForkFormOpen(false); setForkMsg(null); }}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-bg-card border border-border text-slate-400 hover:text-white transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {forkMsg && (
          <div className={`text-sm mt-2 ${forkMsg.ok ? 'text-green-trade' : 'text-red-trade'}`}>
            {forkMsg.msg}
          </div>
        )}
        {strategy.pauseReason && (
          <div className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 mt-2">
            Paused: {strategy.pauseReason}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className={`text-xl font-bold tabular-nums ${pnl >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-600 mt-1">PnL</div>
        </div>
        {strategy.allocatedCapital != null ? (
          <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-white tabular-nums">${strategy.allocatedCapital.toLocaleString()}</div>
            <div className="text-[10px] text-slate-600 mt-1">Capital</div>
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-white tabular-nums">{strategy.totalTrades}</div>
            <div className="text-[10px] text-slate-600 mt-1">Total Trades</div>
          </div>
        )}
        {currentEquity != null ? (
          <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-white tabular-nums">${currentEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-[10px] text-slate-600 mt-1">Current Equity</div>
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-white tabular-nums">{winRate.toFixed(1)}%</div>
            <div className="text-[10px] text-slate-600 mt-1">Win Rate</div>
          </div>
        )}
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-xl font-bold text-white tabular-nums">{formatDuration(strategy.createdAt)}</div>
          <div className="text-[10px] text-slate-600 mt-1">Running</div>
        </div>
      </div>

      {/* Additional info row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-lg font-bold text-white tabular-nums">{strategy.totalTrades}</div>
          <div className="text-[10px] text-slate-600 mt-1">Trades</div>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-lg font-bold text-white tabular-nums">{winRate.toFixed(1)}%</div>
          <div className="text-[10px] text-slate-600 mt-1">Win Rate</div>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-lg font-bold text-white tabular-nums">{strategy.forkCount}</div>
          <div className="text-[10px] text-slate-600 mt-1">Forks</div>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-lg font-bold text-white tabular-nums">{strategy.checkIntervalSeconds}s</div>
          <div className="text-[10px] text-slate-600 mt-1">Interval</div>
        </div>
      </div>

      {/* Strategy Positions */}
      {strategy.positions && strategy.positions.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6 mb-6">
          <h2 className="text-white font-bold text-sm mb-4">Strategy Positions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 text-slate-600 font-medium">Symbol</th>
                  <th className="py-2 pr-4 text-slate-600 font-medium text-right">Size</th>
                  <th className="py-2 pr-4 text-slate-600 font-medium text-right">Avg Cost</th>
                  <th className="py-2 pr-4 text-slate-600 font-medium text-right">Current Price</th>
                  <th className="py-2 text-slate-600 font-medium text-right">Unrealized PnL</th>
                </tr>
              </thead>
              <tbody>
                {strategy.positions.map((pos) => {
                  const curPrice = prices[pos.symbol] ?? null;
                  const unrealizedPnl = curPrice != null ? (curPrice - pos.avgCost) * pos.size : null;
                  return (
                    <tr key={pos.symbol} className="border-b border-border/50 hover:bg-white/[0.02]">
                      <td className="py-2 pr-4 text-slate-300 font-medium">{pos.symbol}</td>
                      <td className="py-2 pr-4 text-slate-300 tabular-nums text-right">{pos.size}</td>
                      <td className="py-2 pr-4 text-slate-400 tabular-nums text-right">${pos.avgCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="py-2 pr-4 text-slate-300 tabular-nums text-right">
                        {curPrice != null ? `$${curPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '--'}
                      </td>
                      <td className={`py-2 tabular-nums text-right font-medium ${unrealizedPnl != null ? (unrealizedPnl >= 0 ? 'text-green-trade' : 'text-red-trade') : 'text-slate-600'}`}>
                        {unrealizedPnl != null ? `${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Configuration */}
      <div className="bg-bg-card border border-border rounded-xl p-6 mb-6">
        <h2 className="text-white font-bold text-sm mb-4">Strategy Configuration</h2>

        <div className="space-y-4">
          {/* Entry conditions */}
          <div>
            <div className="text-[10px] font-semibold text-[#1E6FFF] uppercase tracking-wider mb-2">Entry Rules</div>
            {entryLines.length > 0 ? (
              <ul className="space-y-1">
                {entryLines.map((line, i) => (
                  <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                    <span className="text-[#1E6FFF] mt-0.5 shrink-0">&#x25B8;</span>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No entry rules configured</p>
            )}
          </div>

          {/* Exit conditions */}
          <div>
            <div className="text-[10px] font-semibold text-[#0ECB81] uppercase tracking-wider mb-2">Exit Rules</div>
            {exitLines.length > 0 ? (
              <ul className="space-y-1">
                {exitLines.map((line, i) => (
                  <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                    <span className="text-[#0ECB81] mt-0.5 shrink-0">&#x25B8;</span>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No exit rules configured</p>
            )}
          </div>

          {/* Risk limits */}
          <div>
            <div className="text-[10px] font-semibold text-[#F6465D] uppercase tracking-wider mb-2">Risk Limits</div>
            {riskLines.length > 0 ? (
              <ul className="space-y-1">
                {riskLines.map((line, i) => (
                  <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                    <span className="text-[#F6465D] mt-0.5 shrink-0">&#x25B8;</span>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No risk limits configured</p>
            )}
          </div>
        </div>
      </div>

      {/* Execution logs (if available — typically only for owners) */}
      {strategy.logs && strategy.logs.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-white font-bold text-sm mb-4">Execution Logs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 text-slate-600 font-medium">Time</th>
                  <th className="py-2 pr-4 text-slate-600 font-medium">Action</th>
                  <th className="py-2 pr-4 text-slate-600 font-medium">Result</th>
                  <th className="py-2 text-slate-600 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {strategy.logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                    <td className="py-2 pr-4 text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-slate-300 font-medium">{log.action}</td>
                    <td className="py-2 pr-4">
                      <span className={log.result === 'success' ? 'text-green-trade' : log.result === 'error' ? 'text-red-trade' : 'text-slate-400'}>
                        {log.result}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500 truncate max-w-[200px]">{log.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
