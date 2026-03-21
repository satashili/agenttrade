'use client';
import { useMemo } from 'react';
import { useMarketStore } from '@/lib/store';
import { useBinanceDepth } from '@/hooks/useBinanceWS';

type Sym = string;

interface Props {
  symbol: Sym;
}

const PRICE_DECIMALS: Record<Sym, number> = { BTC: 1, ETH: 2, SOL: 3 };
const SIZE_DECIMALS: Record<Sym, number> = { BTC: 4, ETH: 3, SOL: 1 };

function fmtPrice(p: number, sym: Sym) {
  const d = PRICE_DECIMALS[sym];
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function OrderBook({ symbol }: Props) {
  const { prices } = useMarketStore();
  const { orderBook } = useBinanceDepth(symbol);
  const price = prices[symbol] ?? 0;

  const sd = SIZE_DECIMALS[symbol];

  const asks = useMemo(() => {
    if (!orderBook.asks.length) return [];
    return orderBook.asks.slice(0, 12).map((lvl) => ({
      price: lvl.price,
      size: lvl.quantity,
      cum: lvl.total,
    }));
  }, [orderBook.asks]);

  const bids = useMemo(() => {
    if (!orderBook.bids.length) return [];
    return orderBook.bids.slice(0, 12).map((lvl) => ({
      price: lvl.price,
      size: lvl.quantity,
      cum: lvl.total,
    }));
  }, [orderBook.bids]);

  const maxCum = Math.max(
    asks[asks.length - 1]?.cum ?? 1,
    bids[bids.length - 1]?.cum ?? 1
  );

  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : 0;
  const spreadPct = asks[0] && bids[0] && bids[0].price > 0
    ? ((spread / bids[0].price) * 100).toFixed(3)
    : null;

  const hasData = asks.length > 0 || bids.length > 0;

  return (
    <div className="flex flex-col border-b border-border overflow-hidden" style={{ height: '42%', minHeight: '230px' }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Order Book</span>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" title="Live from Binance" />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          {spread > 0 && (
            <span title="Difference between the lowest ask and highest bid price. A smaller spread means higher liquidity.">Spread: <span className="text-slate-400">{fmtPrice(spread, symbol)}</span>
              {spreadPct && <span className="text-slate-600 ml-1">({spreadPct}%)</span>}
            </span>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 px-3 py-1 border-b border-border/40 shrink-0">
        <span className="text-[10px] text-slate-500" title="Limit order price level">Price (USDT)</span>
        <span className="text-[10px] text-slate-500 text-right" title="Quantity available at this price level">Size ({symbol})</span>
        <span className="text-[10px] text-slate-500 text-right" title="Cumulative quantity up to this price level. The background bar visualizes this depth.">Total</span>
      </div>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[11px] text-slate-600">Connecting to Binance...</span>
        </div>
      ) : (
        <div className="flex flex-col flex-1 overflow-hidden text-[11px]">
          {/* Asks — reversed so best ask is closest to mid */}
          <div className="flex-1 overflow-hidden flex flex-col-reverse">
            {asks.slice().reverse().map((lvl, i) => (
              <div key={i} className="grid grid-cols-3 px-3 py-[2px] relative hover:bg-bg-secondary/60 cursor-default">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-red-trade/8 pointer-events-none"
                  style={{ width: `${(lvl.cum / maxCum) * 100}%` }}
                />
                <span className="text-red-trade tabular-nums relative z-10">{fmtPrice(lvl.price, symbol)}</span>
                <span className="text-right text-slate-400 tabular-nums relative z-10">{lvl.size.toFixed(sd)}</span>
                <span className="text-right text-slate-500 tabular-nums relative z-10">{lvl.cum.toFixed(sd)}</span>
              </div>
            ))}
          </div>

          {/* Mid price bar */}
          <div className="px-3 py-1 border-y border-border/60 bg-bg-secondary flex items-center gap-2 shrink-0">
            <span className="text-sm font-bold tabular-nums text-slate-100">
              {price ? fmtPrice(price, symbol) : '—'}
            </span>
            <span className="text-[10px] text-slate-500">USDT</span>
          </div>

          {/* Bids */}
          <div className="flex-1 overflow-hidden">
            {bids.map((lvl, i) => (
              <div key={i} className="grid grid-cols-3 px-3 py-[2px] relative hover:bg-bg-secondary/60 cursor-default">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-green-trade/8 pointer-events-none"
                  style={{ width: `${(lvl.cum / maxCum) * 100}%` }}
                />
                <span className="text-green-trade tabular-nums relative z-10">{fmtPrice(lvl.price, symbol)}</span>
                <span className="text-right text-slate-400 tabular-nums relative z-10">{lvl.size.toFixed(sd)}</span>
                <span className="text-right text-slate-500 tabular-nums relative z-10">{lvl.cum.toFixed(sd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
