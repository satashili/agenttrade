'use client';
import { useBinanceTicker } from '@/hooks/useBinanceWS';

interface Props {
  symbol: 'BTC' | 'ETH' | 'SOL';
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(2) + 'K';
  return v.toFixed(2);
}

function formatPrice(price: number, symbol: string): string {
  const decimals = symbol === 'BTC' ? 2 : symbol === 'ETH' ? 2 : 4;
  return price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function TickerBar({ symbol }: Props) {
  const { ticker, priceDirection } = useBinanceTicker(symbol);

  const isPositive = ticker ? ticker.priceChangePct >= 0 : true;
  const priceColor = priceDirection === 'up'
    ? 'text-green-trade'
    : priceDirection === 'down'
      ? 'text-red-trade'
      : 'text-white';

  return (
    <div
      className="flex items-center gap-4 px-4 border-b border-border shrink-0"
      style={{ height: '36px', backgroundColor: '#0B0E11', fontFamily: "'DM Mono', monospace" }}
    >
      {/* Symbol */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold text-white">{symbol}/USDT</span>
        <span className="text-[9px] bg-accent/20 text-accent px-1.5 py-px rounded font-medium">Perp</span>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-border" />

      {/* Price */}
      <div className="shrink-0">
        {ticker ? (
          <span
            className={`text-sm font-bold tabular-nums transition-colors duration-150 ${priceColor}`}
          >
            ${formatPrice(ticker.lastPrice, symbol)}
          </span>
        ) : (
          <span className="text-sm text-slate-500 animate-pulse">—</span>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-border" />

      {/* 24h Change */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[9px] text-slate-500 leading-none">24h Change</span>
        {ticker ? (
          <span className={`text-xs tabular-nums font-medium ${isPositive ? 'text-green-trade' : 'text-red-trade'}`}>
            {isPositive ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%
          </span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>

      {/* 24h High */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[9px] text-slate-500 leading-none">24h High</span>
        {ticker ? (
          <span className="text-xs tabular-nums text-slate-300">${formatPrice(ticker.high24h, symbol)}</span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>

      {/* 24h Low */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[9px] text-slate-500 leading-none">24h Low</span>
        {ticker ? (
          <span className="text-xs tabular-nums text-slate-300">${formatPrice(ticker.low24h, symbol)}</span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>

      {/* 24h Volume */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[9px] text-slate-500 leading-none">24h Volume</span>
        {ticker ? (
          <span className="text-xs tabular-nums text-slate-300">{formatVolume(ticker.volume24h)} {symbol}</span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>
    </div>
  );
}
