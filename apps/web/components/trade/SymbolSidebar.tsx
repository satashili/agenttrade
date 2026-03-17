'use client';
import { useEffect, useState, useRef } from 'react';
import { useMarketStore } from '@/lib/store';

type Sym = 'BTC' | 'ETH' | 'TSLA' | 'AMZN' | 'COIN' | 'MSTR' | 'INTC' | 'HOOD' | 'CRCL' | 'PLTR';

const SYMBOLS: Sym[] = ['TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR', 'BTC', 'ETH'];
const COLORS: Record<Sym, string> = {
  BTC: '#f7931a', ETH: '#627eea',
  TSLA: '#cc0000', AMZN: '#ff9900', COIN: '#0052ff', MSTR: '#d9232e',
  INTC: '#0071c5', HOOD: '#00c805', CRCL: '#3cb98e', PLTR: '#1d1d1d',
};
const DECIMALS: Record<Sym, number> = {
  BTC: 0, ETH: 0,
  TSLA: 2, AMZN: 2, COIN: 2, MSTR: 2, INTC: 2, HOOD: 2, CRCL: 2, PLTR: 2,
};

interface Props { selectedSymbol: Sym; onSelect: (sym: Sym) => void; }
interface Stats { [sym: string]: { changePct24h: number }; }

export function SymbolSidebar({ selectedSymbol, onSelect }: Props) {
  const { prices } = useMarketStore();
  const [stats, setStats] = useState<Stats>({});

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const f = () => fetch(`${apiBase}/api/v1/market/stats`).then(r => r.ok ? r.json() : {}).then(setStats).catch(() => {});
    f();
    const i = setInterval(f, 30_000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="w-[60px] shrink-0 bg-[#0B0E11] border-r border-border flex flex-col items-center pt-2 gap-0.5 overflow-y-auto">
      {/* Stocks section */}
      <div className="text-[7px] text-slate-600 font-medium mb-0.5">STOCKS</div>
      {(['TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR'] as Sym[]).map((sym) => (
        <SymButton key={sym} sym={sym} prices={prices} stats={stats} selected={selectedSymbol} onSelect={onSelect} />
      ))}
      {/* Divider */}
      <div className="w-8 border-t border-border/50 my-1" />
      <div className="text-[7px] text-slate-600 font-medium mb-0.5">CRYPTO</div>
      {(['BTC', 'ETH'] as Sym[]).map((sym) => (
        <SymButton key={sym} sym={sym} prices={prices} stats={stats} selected={selectedSymbol} onSelect={onSelect} />
      ))}
      <div className="flex-1" />
      <div className="pb-2 flex flex-col items-center gap-0.5">
        <span className="w-1 h-1 bg-[#0ECB81] rounded-full animate-pulse" />
        <span className="text-[7px] text-slate-600">Binance</span>
      </div>
    </div>
  );
}

function SymButton({ sym, prices, stats, selected, onSelect }: {
  sym: Sym; prices: Record<string, number | undefined>; stats: Stats; selected: Sym; onSelect: (s: Sym) => void;
}) {
  const price = prices[sym];
  const pct = stats[sym]?.changePct24h ?? 0;
  const isUp = pct >= 0;
  const sel = sym === selected;
  const dec = DECIMALS[sym];

  return (
    <button
      onClick={() => onSelect(sym)}
      className={`w-[52px] py-1.5 rounded text-center transition-all ${
        sel ? 'bg-[#1e2329] border border-[#1E6FFF]/30' : 'hover:bg-[#1e2329] border border-transparent'
      }`}
    >
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORS[sym] }} />
        <span className={`text-[9px] font-bold ${sel ? 'text-white' : 'text-slate-400'}`}>{sym}</span>
      </div>
      <div className="text-[8px] tabular-nums text-slate-500">
        {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—'}
      </div>
      {pct !== 0 && (
        <div className={`text-[7px] tabular-nums font-medium ${isUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
          {isUp ? '+' : ''}{pct.toFixed(1)}%
        </div>
      )}
    </button>
  );
}
