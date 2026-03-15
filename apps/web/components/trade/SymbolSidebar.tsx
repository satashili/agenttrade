'use client';
import { useEffect, useState, useRef } from 'react';
import { useMarketStore } from '@/lib/store';

type Sym = 'BTC' | 'ETH' | 'SOL';

const SYMBOLS: Sym[] = ['BTC', 'ETH', 'SOL'];

const SYMBOL_COLORS: Record<Sym, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
};

const SYMBOL_DECIMALS: Record<Sym, number> = {
  BTC: 0,
  ETH: 2,
  SOL: 2,
};

interface Props {
  selectedSymbol: Sym;
  onSelect: (sym: Sym) => void;
}

interface Stats {
  [sym: string]: { change24h: number; changePct24h: number };
}

function fmt(price: number, sym: Sym) {
  const d = SYMBOL_DECIMALS[sym];
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function PriceWithFlash({ price, sym }: { price: number | undefined; sym: Sym }) {
  const prevRef = useRef(price);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (price === undefined || prevRef.current === undefined) { prevRef.current = price; return; }
    if (price > prevRef.current) setFlash('price-flash-up');
    else if (price < prevRef.current) setFlash('price-flash-down');
    prevRef.current = price;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return (
    <div className={`text-xs tabular-nums font-medium text-slate-200 ml-3.5 rounded px-0.5 ${flash ?? ''}`}>
      {price ? `$${fmt(price, sym)}` : '—'}
    </div>
  );
}

export function SymbolSidebar({ selectedSymbol, onSelect }: Props) {
  const { prices } = useMarketStore();
  const [stats, setStats] = useState<Stats>({});

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const fetchStats = () => {
      fetch(`${apiBase}/api/v1/market/stats`)
        .then(r => r.ok ? r.json() : {})
        .then(setStats)
        .catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-44 shrink-0 bg-bg-card border-r border-border flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border">
        <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Markets</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {SYMBOLS.map((sym) => {
          const price = prices[sym];
          const pct = stats[sym]?.changePct24h ?? 0;
          const isUp = pct >= 0;
          const isSelected = sym === selectedSymbol;

          return (
            <button
              key={sym}
              onClick={() => onSelect(sym)}
              className={`w-full px-3 py-3 text-left transition-all border-b border-border/40 ${
                isSelected
                  ? 'bg-accent/10 border-l-2 border-l-accent'
                  : 'hover:bg-bg-hover border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: SYMBOL_COLORS[sym] }}
                />
                <span className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                  {sym}
                </span>
                <span className="text-slate-600 text-[10px]">/ USDT</span>
              </div>
              <PriceWithFlash price={price} sym={sym} />
              <div className={`text-[11px] tabular-nums mt-0.5 ml-3.5 ${isUp ? 'text-green-trade' : 'text-red-trade'}`}>
                {pct !== 0 ? `${isUp ? '+' : ''}${pct.toFixed(2)}%` : <span className="text-slate-600">—</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-green-trade rounded-full animate-pulse" />
          <span className="text-[10px] text-slate-500">Live · Binance</span>
        </div>
      </div>
    </div>
  );
}
