'use client';
import { useEffect, useState } from 'react';
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
const NAMES: Record<Sym, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum',
  TSLA: 'Tesla', AMZN: 'Amazon', COIN: 'Coinbase', MSTR: 'MicroStrategy',
  INTC: 'Intel', HOOD: 'Robinhood', CRCL: 'Circle', PLTR: 'Palantir',
};

interface Props { selectedSymbol: Sym; onSelect: (sym: Sym) => void; width?: number; }
interface Stats { [sym: string]: { changePct24h: number }; }

const WIDE_THRESHOLD = 90;

export function SymbolSidebar({ selectedSymbol, onSelect, width = 120 }: Props) {
  const { prices } = useMarketStore();
  const [stats, setStats] = useState<Stats>({});
  const wide = width >= WIDE_THRESHOLD;

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const f = () => fetch(`${apiBase}/api/v1/market/stats`).then(r => r.ok ? r.json() : {}).then(setStats).catch(() => {});
    f();
    const i = setInterval(f, 30_000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="w-full h-full bg-[#0B0E11] flex flex-col pt-2 gap-0.5 overflow-y-auto">
      <div className={`text-[7px] text-slate-600 font-medium mb-0.5 ${wide ? 'px-2.5' : 'text-center'}`}>STOCKS</div>
      {(['TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR'] as Sym[]).map((sym) => (
        <SymButton key={sym} sym={sym} prices={prices} stats={stats} selected={selectedSymbol} onSelect={onSelect} wide={wide} />
      ))}
      <div className={`border-t border-border/50 my-1 ${wide ? 'mx-2.5' : 'mx-3'}`} />
      <div className={`text-[7px] text-slate-600 font-medium mb-0.5 ${wide ? 'px-2.5' : 'text-center'}`}>CRYPTO</div>
      {(['BTC', 'ETH'] as Sym[]).map((sym) => (
        <SymButton key={sym} sym={sym} prices={prices} stats={stats} selected={selectedSymbol} onSelect={onSelect} wide={wide} />
      ))}
      <div className="flex-1" />
      <div className={`pb-2 flex items-center gap-1 ${wide ? 'px-2.5' : 'flex-col justify-center'}`}>
        <span className="w-1 h-1 bg-[#0ECB81] rounded-full animate-pulse" />
        <span className="text-[7px] text-slate-600">Binance</span>
      </div>
    </div>
  );
}

function SymButton({ sym, prices, stats, selected, onSelect, wide }: {
  sym: Sym; prices: Record<string, number | undefined>; stats: Stats; selected: Sym; onSelect: (s: Sym) => void; wide: boolean;
}) {
  const price = prices[sym];
  const pct = stats[sym]?.changePct24h ?? 0;
  const isUp = pct >= 0;
  const sel = sym === selected;
  const dec = DECIMALS[sym];
  const priceStr = price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—';
  const pctStr = pct !== 0 ? `${isUp ? '+' : ''}${pct.toFixed(1)}%` : null;

  if (!wide) {
    return (
      <button
        onClick={() => onSelect(sym)}
        className={`w-full mx-1 py-1.5 rounded text-center transition-all ${
          sel ? 'bg-[#1e2329] border border-[#1E6FFF]/30' : 'hover:bg-[#1e2329] border border-transparent'
        }`}
      >
        <div className="flex items-center justify-center gap-1 mb-0.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORS[sym] }} />
          <span className={`text-[9px] font-bold ${sel ? 'text-white' : 'text-slate-400'}`}>{sym}</span>
        </div>
        <div className="text-[8px] tabular-nums text-slate-500">{priceStr}</div>
        {pctStr && (
          <div className={`text-[7px] tabular-nums font-medium ${isUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>{pctStr}</div>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(sym)}
      className={`w-full px-2.5 py-1.5 rounded transition-all text-left ${
        sel ? 'bg-[#1e2329] border border-[#1E6FFF]/30' : 'hover:bg-[#1e2329] border border-transparent'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[sym] }} />
        <span className={`text-[10px] font-bold truncate ${sel ? 'text-white' : 'text-slate-300'}`}>{sym}</span>
        {pctStr && (
          <span className={`text-[9px] tabular-nums font-medium ml-auto shrink-0 ${isUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>{pctStr}</span>
        )}
      </div>
      <div className="flex items-center justify-between mt-0.5 ml-[13px]">
        <span className="text-[8px] text-slate-600 truncate">{NAMES[sym]}</span>
        <span className="text-[9px] tabular-nums text-slate-500 shrink-0">{priceStr}</span>
      </div>
    </button>
  );
}
