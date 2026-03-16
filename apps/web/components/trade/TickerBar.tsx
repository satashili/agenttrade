'use client';
import { useRef, useEffect, useState } from 'react';
import { useBinanceTicker } from '@/hooks/useBinanceWS';

interface Props { symbol: string; }

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}

function fmtPrice(p: number, sym: string): string {
  const d = sym === 'BTC' ? 0 : 2;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function TickerBar({ symbol }: Props) {
  const { ticker, priceDirection } = useBinanceTicker(symbol);
  const prevDir = useRef(priceDirection);
  const [flash, setFlash] = useState(false);

  // Only flash briefly on direction change, not every tick
  useEffect(() => {
    if (priceDirection && priceDirection !== prevDir.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 300);
      prevDir.current = priceDirection;
      return () => clearTimeout(t);
    }
  }, [priceDirection]);

  const isUp = ticker ? ticker.priceChangePct >= 0 : true;
  const dirColor = flash
    ? (priceDirection === 'up' ? 'text-[#0ECB81]' : 'text-[#F6465D]')
    : 'text-[#eaecef]';

  return (
    <div className="flex items-center gap-5 px-4 h-9 border-b border-border shrink-0 bg-[#0B0E11]" style={{ fontFamily: "'DM Mono', monospace" }}>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold text-white tracking-tight">{symbol}USDT</span>
        <span className="text-[8px] bg-[#2b3139] text-slate-400 px-1 py-px rounded">SPOT</span>
      </div>

      <div className="w-px h-4 bg-border" />

      {ticker ? (
        <>
          <span className={`text-[15px] font-bold tabular-nums transition-colors duration-200 ${dirColor}`}>
            {fmtPrice(ticker.lastPrice, symbol)}
          </span>

          <div className="flex items-center gap-4 text-[11px]">
            <div>
              <span className="text-slate-500 mr-1">24h Change</span>
              <span className={`tabular-nums font-medium ${isUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                {isUp ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">High</span>
              <span className="tabular-nums text-slate-300">{fmtPrice(ticker.high24h, symbol)}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">Low</span>
              <span className="tabular-nums text-slate-300">{fmtPrice(ticker.low24h, symbol)}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">Vol(USDT)</span>
              <span className="tabular-nums text-slate-300">{fmtVol(ticker.volume24h)}</span>
            </div>
          </div>
        </>
      ) : (
        <span className="text-sm text-slate-600">Connecting...</span>
      )}
    </div>
  );
}
