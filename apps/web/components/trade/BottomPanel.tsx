'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

type Sym = 'BTC' | 'ETH' | 'SOL';
type Tab = 'open' | 'history' | 'positions' | 'assets';

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

function usd(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function BottomPanel({ symbol }: Props) {
  const [tab,       setTab]       = useState<Tab>('open');
  const [orders,    setOrders]    = useState<Order[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading,   setLoading]   = useState(false);
  const { token } = useAuthStore();

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.get<{ data: Order[] }>('/api/v1/orders?limit=100'),
      api.get<Portfolio>('/api/v1/portfolio'),
    ])
      .then(([o, p]) => { setOrders(o.data ?? []); setPortfolio(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  async function cancel(id: string) {
    try {
      await api.delete(`/api/v1/orders/${id}`);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch {}
  }

  const openOrders    = orders.filter(o => ['pending', 'open'].includes(o.status));
  const historyOrders = orders.filter(o => !['pending', 'open'].includes(o.status));

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'open',      label: 'Open Orders', badge: openOrders.length || undefined },
    { id: 'history',   label: 'Order History' },
    { id: 'positions', label: 'Positions', badge: portfolio?.positions.length || undefined },
    { id: 'assets',    label: 'Assets' },
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
        {token && (
          <button
            onClick={refresh}
            className="px-3 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >↻ Refresh</button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!token ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-slate-600">
              <a href="/login" className="text-accent hover:underline">Login</a> to view trading data
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-slate-600 animate-pulse">Loading…</span>
          </div>
        ) : (
          <>
            {/* Open Orders */}
            {tab === 'open' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Symbol','Type','Side','Price','Size','Filled','Status','Action'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Symbol' || h === 'Type' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openOrders.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-6 text-slate-600 text-xs">No open orders</td></tr>
                  ) : openOrders.map(o => (
                    <tr key={o.id} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white">{o.symbol}</td>
                      <td className="px-3 py-1.5 text-slate-400 capitalize">{o.type}</td>
                      <td className={`px-3 py-1.5 text-right capitalize font-medium ${o.side === 'buy' ? 'text-green-trade' : 'text-red-trade'}`}>{o.side}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{o.price ? `$${usd(o.price)}` : 'Market'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{o.size}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{o.filledSize ?? 0}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400 capitalize">{o.status}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button onClick={() => cancel(o.id)} className="text-red-trade hover:text-red-trade/70 text-[10px] transition-colors">Cancel</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Order History */}
            {tab === 'history' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Symbol','Type','Side','Avg Price','Size','Status','Fee','Date'].map(h => (
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

            {/* Positions */}
            {tab === 'positions' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr className="text-[10px] text-slate-500 border-b border-border/50">
                    {['Symbol','Size','Avg Cost','Mark Price','Value','Unrealized PnL'].map(h => (
                      <th key={h} className={`px-3 py-1.5 font-normal ${h === 'Symbol' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!portfolio?.positions.length ? (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-600 text-xs">No open positions</td></tr>
                  ) : portfolio.positions.map((p, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-bg-secondary/50">
                      <td className="px-3 py-1.5 font-medium text-white">{p.symbol}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{p.size}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(p.avgCost)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(p.currentPrice)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">${usd(p.value)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${p.pnl >= 0 ? 'text-green-trade' : 'text-red-trade'}`}>
                        {p.pnl >= 0 ? '+' : ''}{usd(p.pnl)}&nbsp;
                        <span className="text-[10px] opacity-75">({p.pnlPct.toFixed(2)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Assets */}
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
                        sub: `vs $100,000 initial`,
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
