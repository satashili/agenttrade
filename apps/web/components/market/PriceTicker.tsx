'use client';
import { useMarketStore } from '@/lib/store';
import clsx from 'clsx';

const SYMBOLS = ['TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR', 'BTC', 'ETH'] as const;
const SYMBOL_COLORS: Record<string, string> = {
  BTC: '#f7931a', ETH: '#627eea',
  TSLA: '#cc0000', AMZN: '#ff9900', COIN: '#0052ff', MSTR: '#d9232e',
  INTC: '#0071c5', HOOD: '#00c805', CRCL: '#3cb98e', PLTR: '#101010',
};

interface PriceTickerProps {
  stats?: Record<string, { change24h: number; changePct24h: number }>;
}

export function PriceTicker({ stats }: PriceTickerProps) {
  const { prices } = useMarketStore();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
      {SYMBOLS.map((sym) => {
        const price = prices[sym];
        const stat = stats?.[sym];
        const pct = stat?.changePct24h ?? 0;
        const isUp = pct >= 0;

        return (
          <div key={sym} className="bg-bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: SYMBOL_COLORS[sym] }}
                />
                <span className="text-slate-400 text-sm font-medium">{sym}/USDT</span>
              </div>
              <span className={clsx('text-xs font-medium px-1.5 py-0.5 rounded', isUp ? 'text-green-trade bg-green-trade/10' : 'text-red-trade bg-red-trade/10')}>
                {isUp ? '+' : ''}{pct.toFixed(2)}%
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-white">
              {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: (sym === 'BTC') ? 0 : 2, maximumFractionDigits: (sym === 'BTC') ? 0 : 2 })}` : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
