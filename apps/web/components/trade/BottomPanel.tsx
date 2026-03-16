'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore, useMarketStore } from '@/lib/store';
import { api } from '@/lib/api';

type Sym = string;
type Tab = 'activity' | 'history' | 'positions' | 'open' | 'assets';

interface Props { symbol: Sym; }

interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  status: string;
  price?: number;
  stopPrice?: number;
  size: number;
  filledSize?: number;
  avgFillPrice?: number;
  fee?: number;
  createdAt: string;
}

interface Position {
  symbol: string;
  size: number;
  avgCost: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  value: number;
}

interface Portfolio {
  account: { balance: number; initialBalance: number; totalValue: number; totalPnl: number; totalPnlPct: number };
  positions: Position[];
}

interface TradeRecord {
  id: string;
  agentName: string;
  agentDisplayName: string | null;
  symbol: string;
  side: string;
  size: number;
  price: number | null;
  value: number | null;
  filledAt: string | null;
}

function usd(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function BottomPanel({ symbol }: Props) {
  const [tab, setTab] = useState<Tab>('activity');
  const [orders, setOrders] = useState<Order[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [platformTrades, setPlatformTrades] = useState<TradeRecord[]>([]);
  const [platformPositions, setPlatformPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { token, user } = useAuthStore();
  const { tradeActivity } = useMarketStore();

  const isLoggedIn = !!token;

  // Load platform-wide data (for everyone) + personal data (for logged-in users)
  const refresh = useCallback(() => {
    setLoading(true);
    const promises: Promise<any>[] = [
      // Always load platform trades
      api.get<{ data: TradeRecord[] }>('/api/v1/market/trades?limit=50')
        .then(r => setPlatformTrades(r.data))
        .catch(() => {}),
    ];

    if (isLoggedIn) {
      promises.push(
        api.get<{ data: Order[] }>('/api/v1/orders?limit=100')
          .then(o => setOrders(o.data ?? []))
          .catch(() => {}),
        api.get<Portfolio>('/api/v1/portfolio')
          .then(p => setPortfolio(p))
          .catch(() => {}),
      );
    }

    Promise.all(promises).finally(() => setLoading(false));
  }, [isLoggedIn]);

  useEffect(() => { refresh(); }, [refresh]);

  async function cancel(id: string) {
    try {
      await api.delete(`/api/v1/orders/${id}`);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch {}
  }

  const openOrders = orders.filter(o => ['pending', 'open'].includes(o.status));
  const historyOrders = orders.filter(o => !['pending', 'open'].includes(o.status));

  // Merge real-time tradeActivity with loaded platformTrades for AI Activity
  const allActivity = [
    ...tradeActivity.map(a => ({
      id: `ws-${a.ts}`,
      agentName: a.agentName,
      symbol: a.symbol,
      side: a.side,
      size: a.size,
      price: a.price,
      ts: a.ts,
    })),
    ...platformTrades
      .filter(t => !tradeActivity.some(a => Math.abs(a.ts - new Date(t.filledAt || 0).getTime()) < 1000 && a.symbol === t.symbol && a.size === t.size))
      .map(t => ({
        id: t.id,
        agentName: t.agentDisplayName || t.agentName,
        symbol: t.symbol,
        side: t.side,
        size: t.size,
        price: t.price ?? 0,
        ts: t.filledAt ? new Date(t.filledAt).getTime() : 0,
      })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 50);

  const TABS: { id: Tab; label: string; badge?: number }[] = isLoggedIn
    ? [
        { id: 'activity', label: 'Activity', badge: allActivity.length || undefined },
        { id: 'open', label: 'Open Orders', badge: openOrders.length || undefined },
        { id: 'history', label: 'Order History' },
        { id: 'positions', label: 'Positions', badge: portfolio?.positions.length || undefined },
        { id: 'assets', label: 'Assets' },
      ]
    : [
        { id: 'activity', label: 'Activity', badge: allActivity.length || undefined },
        { id: 'history', label: 'Recent Trades' },
        { id: 'positions', label: 'Leaderboard' },
      ];

  return (
    <div className="border-t border-border bg-bg-card flex flex-col" style={{ height: '220px' }}>
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              tab === t.id
                ? 'text-white border-b-2 border-accent -mb-px'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
            {t.badge ? (
              <span className="bg-accent/25 text-accent text-[10px] px-1.5 py-px rounded-full">{t.badge}</span>
            ) : null}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={refresh}
          className="px-3 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
        >↻ Refresh</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-slate-600 animate-pulse">Loading...</span>
          </div>
        )}

        {!loading && (
          <>
            {/* AI Activity — always visible, merged real-time + historical */}
            {tab === 'activity' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Agent', 'Side', 'Symbol', 'Size', 'Price', 'Time'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Agent' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allActivity.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-600 text-xs">No AI activity yet</td></tr>
                  ) : allActivity.map((a) => (
                    <tr key={a.id} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white truncate max-w-[140px]">{a.agentName}</td>
                      <td className={`px-3 py-1.5 text-right font-medium ${a.side === 'buy' ? 'text-green-trade' : 'text-red-trade'}`}>
                        <span className={`text-[10px] px-1.5 py-px rounded ${a.side === 'buy' ? 'bg-green-trade/15' : 'bg-red-trade/15'}`}>
                          {a.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-300">{a.symbol}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{a.size}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(a.price)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500 text-[10px]">{a.ts ? timeAgo(a.ts) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Recent Trades (platform-wide for observers) / Order History (for agents) */}
            {tab === 'history' && !isLoggedIn && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Agent', 'Symbol', 'Side', 'Size', 'Price', 'Value', 'Time'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Agent' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {platformTrades.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-6 text-slate-600 text-xs">No trades yet</td></tr>
                  ) : platformTrades.map(t => (
                    <tr key={t.id} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white truncate max-w-[140px]">{t.agentDisplayName || t.agentName}</td>
                      <td className="px-3 py-1.5 text-right text-slate-300">{t.symbol}</td>
                      <td className={`px-3 py-1.5 text-right font-medium ${t.side === 'buy' ? 'text-green-trade' : 'text-red-trade'}`}>
                        <span className={`text-[10px] px-1.5 py-px rounded ${t.side === 'buy' ? 'bg-green-trade/15' : 'bg-red-trade/15'}`}>
                          {t.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{t.size}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{t.price ? `$${usd(t.price)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{t.value ? `$${usd(t.value)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500 text-[10px]">{t.filledAt ? fmtDate(t.filledAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'history' && isLoggedIn && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Symbol', 'Type', 'Side', 'Avg Price', 'Size', 'Status', 'Fee', 'Date'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Symbol' || h === 'Type' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyOrders.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-6 text-slate-600 text-xs">No order history</td></tr>
                  ) : historyOrders.map(o => (
                    <tr key={o.id} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white">{o.symbol}</td>
                      <td className="px-3 py-1.5 text-slate-400 capitalize">{o.type}</td>
                      <td className={`px-3 py-1.5 text-right capitalize font-medium ${o.side === 'buy' ? 'text-green-trade' : 'text-red-trade'}`}>{o.side}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{o.avgFillPrice ? `$${usd(o.avgFillPrice)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{o.size}</td>
                      <td className={`px-3 py-1.5 text-right capitalize ${o.status === 'filled' ? 'text-green-trade' : 'text-slate-400'}`}>{o.status}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{o.fee ? `$${o.fee.toFixed(4)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500 text-[10px]">{fmtDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Positions: agent sees own, observer sees all agents */}
            {tab === 'positions' && isLoggedIn && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Symbol', 'Size', 'Avg Cost', 'Mark Price', 'Value', 'PnL', 'PnL%'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Symbol' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!portfolio?.positions.length ? (
                    <tr><td colSpan={7} className="text-center py-6 text-slate-600 text-xs">No open positions</td></tr>
                  ) : portfolio.positions.map((p, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white">{p.symbol}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{p.size}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(p.avgCost)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(p.currentPrice)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(p.value)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${p.pnl >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
                        {p.pnl >= 0 ? '+' : ''}${usd(Math.abs(p.pnl))}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${p.pnlPct >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
                        {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'positions' && !isLoggedIn && (
              <PlatformPositions />
            )}

            {/* Open Orders (agent only) */}
            {tab === 'open' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Symbol', 'Type', 'Side', 'Price', 'Size', 'Status', 'Action'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Symbol' || h === 'Type' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openOrders.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-6 text-slate-600 text-xs">No open orders</td></tr>
                  ) : openOrders.map(o => (
                    <tr key={o.id} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white">{o.symbol}</td>
                      <td className="px-3 py-1.5 text-slate-400 capitalize">{o.type}</td>
                      <td className={`px-3 py-1.5 text-right capitalize font-medium ${o.side === 'buy' ? 'text-green-trade' : 'text-red-trade'}`}>{o.side}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{o.price ? `$${usd(o.price)}` : 'Market'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{o.size}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400 capitalize">{o.status}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button onClick={() => cancel(o.id)} className="text-red-trade hover:text-red-trade/70 text-[10px] transition-colors">Cancel</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Assets (agent only) */}
            {tab === 'assets' && (
              <div className="p-4">
                {!portfolio ? (
                  <p className="text-xs text-slate-600 text-center py-4">No data</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Available Balance', value: `$${usd(portfolio.account.balance)}`, sub: 'USDT', color: 'text-white' },
                      { label: 'Total Portfolio Value', value: `$${usd(portfolio.account.totalValue)}`, sub: 'USDT', color: 'text-white' },
                      {
                        label: 'Total PnL',
                        value: `${portfolio.account.totalPnl >= 0 ? '+' : ''}$${usd(portfolio.account.totalPnl)}`,
                        sub: 'vs $100,000 initial',
                        color: portfolio.account.totalPnl >= 0 ? 'text-green-trade' : 'text-red-trade',
                      },
                      {
                        label: 'Return',
                        value: `${portfolio.account.totalPnlPct >= 0 ? '+' : ''}${portfolio.account.totalPnlPct.toFixed(2)}%`,
                        sub: 'all time',
                        color: portfolio.account.totalPnlPct >= 0 ? 'text-green-trade' : 'text-red-trade',
                      },
                    ].map(item => (
                      <div key={item.label} className="bg-bg-secondary rounded-lg p-3 border border-border/50">
                        <div className="text-[10px] text-slate-500 mb-1">{item.label}</div>
                        <div className={`text-sm font-bold tabular-nums ${item.color}`}>{item.value}</div>
                        <div className="text-[10px] text-slate-600 mt-0.5">{item.sub}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Platform-wide positions for observers
function PlatformPositions() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: any[] }>('/api/v1/leaderboard?limit=20')
      .then(r => setData(r.data.filter((a: any) => a.tradeCount > 0)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-xs text-slate-600 text-center py-6 animate-pulse">Loading...</div>;

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-bg-card z-10">
        <tr className="text-[10px] text-slate-500 border-b border-border/50">
          {['Agent', 'Model', 'Portfolio Value', 'PnL%', 'Trades', 'Win Rate'].map(h => (
            <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Agent' ? 'text-left' : 'text-right'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr><td colSpan={6} className="text-center py-6 text-slate-600 text-xs">No agents trading yet</td></tr>
        ) : data.map((a: any) => (
          <tr key={a.agent.id} className="border-b border-border/20 hover:bg-bg-secondary/50">
            <td className="px-3 py-1.5 font-medium text-white truncate max-w-[140px]">{a.agent.displayName || a.agent.name}</td>
            <td className="px-3 py-1.5 text-right text-slate-500 text-[10px]">{a.agent.aiModel || '—'}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(a.totalValue)}</td>
            <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${a.totalPnlPct >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
              {a.totalPnlPct >= 0 ? '+' : ''}{a.totalPnlPct.toFixed(2)}%
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{a.tradeCount}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{a.winRate}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
