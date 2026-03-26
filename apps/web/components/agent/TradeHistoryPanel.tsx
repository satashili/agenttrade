'use client';

import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';

interface TradeRecord {
  symbol: string;
  side: 'buy' | 'sell';
  action: 'open' | 'close' | 'add' | 'reduce' | 'flip';
  size: number;
  price: number;
  fee: number;
  realizedPnl: number | null;
  positionAfter: number;
  reason: string;
  filledAt: string;
}

interface TradesResponse {
  data: TradeRecord[];
  hasMore: boolean;
  nextCursor: string | null;
}

const ACTION_STYLES: Record<string, { label: string; className: string }> = {
  open:   { label: 'Open',   className: 'bg-blue-500/20 text-blue-400' },
  close:  { label: 'Close',  className: 'bg-amber-500/20 text-amber-400' },
  add:    { label: 'Add',    className: 'bg-slate-500/20 text-slate-400' },
  reduce: { label: 'Reduce', className: 'bg-orange-500/20 text-orange-400' },
  flip:   { label: 'Flip',   className: 'bg-purple-500/20 text-purple-400' },
};

function formatPrice(price: number): string {
  return price >= 1000
    ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${price.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatSize(size: number, symbol: string): string {
  if (symbol === 'BTC') return size.toFixed(5);
  if (symbol === 'ETH') return size.toFixed(4);
  return size.toFixed(2);
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function TradeHistoryPanel({ name }: { name: string }) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const fetchTrades = useCallback(async (cursor?: string): Promise<TradesResponse> => {
    const url = new URL(`${API_BASE}/api/v1/users/${name}/trades`);
    url.searchParams.set('limit', '20');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('fetch failed');
    return res.json();
  }, [name]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchTrades()
      .then(d => {
        setTrades(d.data);
        setHasMore(d.hasMore);
        setNextCursor(d.nextCursor);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [fetchTrades]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await fetchTrades(nextCursor);
      setTrades(prev => [...prev, ...d.data]);
      setHasMore(d.hasMore);
      setNextCursor(d.nextCursor);
    } catch {
      // non-critical
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Trade History</h3>
        {!loading && trades.length > 0 && (
          <span className="text-xs text-slate-500">{trades.length}{hasMore ? '+' : ''} trades</span>
        )}
      </div>

      {loading ? (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">Loading…</div>
      ) : error ? (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">Failed to load trade history</div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <div className="text-slate-600 text-2xl mb-2">📭</div>
          <div className="text-slate-500 text-sm">No trades yet</div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-slate-400 text-xs uppercase border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">Symbol</th>
                  <th className="px-4 py-2 text-left font-medium">Side</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">PnL</th>
                  <th className="px-4 py-2 text-right font-medium">Fee</th>
                  <th className="px-4 py-2 text-right font-medium">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trades.map((trade, i) => {
                  const isBuy = trade.side === 'buy';
                  const hasPnl = trade.realizedPnl !== null;
                  const isProfit = hasPnl && trade.realizedPnl! >= 0;
                  const actionStyle = ACTION_STYLES[trade.action] ?? ACTION_STYLES.open;
                  return (
                    <tr key={`${trade.filledAt}-${i}`} className="hover:bg-bg-hover transition-colors">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                        {formatDate(trade.filledAt)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{trade.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs font-semibold',
                          isBuy ? 'text-green-trade' : 'text-red-trade'
                        )}>
                          {isBuy ? '▲ Buy' : '▼ Sell'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          actionStyle.className
                        )}>
                          {actionStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {formatSize(trade.size, trade.symbol)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-white">
                        {formatPrice(trade.price)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {hasPnl ? (
                          <span className={isProfit ? 'text-green-trade' : 'text-red-trade'}>
                            {isProfit ? '+' : '−'}${Math.abs(trade.realizedPnl!).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs">
                        ${trade.fee.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">
                        {trade.positionAfter === 0
                          ? 'Flat'
                          : `${trade.positionAfter > 0 ? '+' : ''}${formatSize(trade.positionAfter, trade.symbol)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-40 py-1"
              >
                {loadingMore ? 'Loading…' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
