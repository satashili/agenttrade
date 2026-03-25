'use client';

import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';

interface CompletedTrade {
  symbol: string;
  direction: 'long' | 'short';
  size: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  totalFee: number;
  closeReason: string;
  openedAt: string;
  closedAt: string;
}

interface TradesResponse {
  data: CompletedTrade[];
  hasMore: boolean;
  nextCursor: string | null;
}

const REASON_STYLES: Record<string, { label: string; className: string }> = {
  strategy:   { label: 'Strategy',  className: 'bg-purple-500/20 text-purple-400' },
  copy_trade: { label: 'Copy',      className: 'bg-blue-500/20 text-blue-400' },
  manual:     { label: 'Manual',    className: 'bg-slate-500/20 text-slate-400' },
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
  const [trades, setTrades] = useState<CompletedTrade[]>([]);
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
          <span className="text-xs text-slate-500">{trades.length}{hasMore ? '+' : ''} completed</span>
        )}
      </div>

      {loading ? (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">Loading…</div>
      ) : error ? (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">Failed to load trade history</div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <div className="text-slate-600 text-2xl mb-2">📭</div>
          <div className="text-slate-500 text-sm">No completed trades yet</div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-slate-400 text-xs uppercase border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">Symbol</th>
                  <th className="px-4 py-2 text-left font-medium">Direction</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                  <th className="px-4 py-2 text-right font-medium">Entry</th>
                  <th className="px-4 py-2 text-right font-medium">Exit</th>
                  <th className="px-4 py-2 text-right font-medium">PnL</th>
                  <th className="px-4 py-2 text-right font-medium">Fee</th>
                  <th className="px-4 py-2 text-left font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trades.map((trade, i) => {
                  const isProfit = trade.realizedPnl >= 0;
                  const reason = REASON_STYLES[trade.closeReason] ?? REASON_STYLES.manual;
                  return (
                    <tr key={`${trade.closedAt}-${i}`} className="hover:bg-bg-hover transition-colors">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                        {formatDate(trade.closedAt)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{trade.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs font-semibold',
                          trade.direction === 'long' ? 'text-green-trade' : 'text-red-trade'
                        )}>
                          {trade.direction === 'long' ? '▲ Long' : '▼ Short'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {formatSize(trade.size, trade.symbol)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                        {formatPrice(trade.entryPrice)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-white">
                        {formatPrice(trade.exitPrice)}
                      </td>
                      <td className={clsx(
                        'px-4 py-3 text-right tabular-nums font-semibold',
                        isProfit ? 'text-green-trade' : 'text-red-trade'
                      )}>
                        {isProfit ? '+' : '−'}${Math.abs(trade.realizedPnl).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs">
                        ${trade.totalFee.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          reason.className
                        )}>
                          {reason.label}
                        </span>
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
