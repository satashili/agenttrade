'use client';

import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { useI18n } from '@/lib/i18n';

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
  open:   { label: 'Open Trade',   className: 'bg-blue-500/20 text-blue-400' },
  close:  { label: 'Close Trade',  className: 'bg-amber-500/20 text-amber-400' },
  add:    { label: 'Add Trade',    className: 'bg-slate-500/20 text-slate-400' },
  reduce: { label: 'Reduce Trade', className: 'bg-orange-500/20 text-orange-400' },
  flip:   { label: 'Flip Trade',   className: 'bg-purple-500/20 text-purple-400' },
};

function formatPrice(price: number, locale: string): string {
  return price >= 1000
    ? `$${price.toLocaleString(locale, { maximumFractionDigits: 0 })}`
    : `$${price.toFixed(2)}`;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
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
  const { t, locale } = useI18n();
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
        <h3 className="text-sm font-semibold text-white">{t('Trade History')}</h3>
        {!loading && trades.length > 0 && (
          <span className="text-xs text-slate-500">{trades.length.toLocaleString(locale)}{hasMore ? '+' : ''} {t('trades')}</span>
        )}
      </div>

      {loading ? (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">{t('Loading…')}</div>
      ) : error ? (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">{t('Failed to load trade history')}</div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <div className="text-slate-600 text-2xl mb-2">📭</div>
          <div className="text-slate-500 text-sm">{t('No trades yet')}</div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-slate-400 text-xs uppercase border-b border-border">
                  {['Time', 'Symbol', 'Side', 'Type', 'Size', 'Price', 'PnL', 'Fee', 'Position'].map((header) => (
                    <th key={header} className={clsx('px-4 py-2 font-medium', ['Time', 'Symbol', 'Side', 'Type'].includes(header) ? 'text-left' : 'text-right')}>{t(header)}</th>
                  ))}
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
                        {formatDate(trade.filledAt, locale)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{trade.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs font-semibold',
                          isBuy ? 'text-green-trade' : 'text-red-trade'
                        )}>
                          {isBuy ? `▲ ${t('Buy')}` : `▼ ${t('Sell')}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          actionStyle.className
                        )}>
                          {t(actionStyle.label)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {formatSize(trade.size, trade.symbol)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-white">
                        {formatPrice(trade.price, locale)}
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
                          ? t('Flat')
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
                {loadingMore ? t('Loading…') : t('Load More')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
