'use client';
import { useMarketStore } from '@/lib/store';

type Sym = 'BTC' | 'ETH' | 'SOL';

interface Props { symbol: Sym; }

const DECIMALS: Record<Sym, number> = { BTC: 0, ETH: 2, SOL: 2 };
const SIZE_DEC: Record<Sym, number> = { BTC: 3, ETH: 2, SOL: 1 };

function fmtPrice(p: number, sym: Sym) {
  const d = DECIMALS[sym];
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function RecentTrades({ symbol }: Props) {
  const { tradeActivity } = useMarketStore();
  const trades = tradeActivity.filter(t => t.symbol === symbol).slice(0, 25);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-white">Recent Trades</span>
      </div>

      <div className="grid grid-cols-3 px-3 py-1 border-b border-border/40 shrink-0">
        <span className="text-[10px] text-slate-500">Price (USDT)</span>
        <span className="text-[10px] text-slate-500 text-right">Size</span>
        <span className="text-[10px] text-slate-500 text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 gap-1">
            <span className="text-[11px] text-slate-600">Waiting for trades…</span>
          </div>
        ) : (
          trades.map((t, i) => (
            <div
              key={i}
              className="grid grid-cols-3 px-3 py-[3px] text-[11px] hover:bg-bg-secondary/40"
            >
              <span className={`tabular-nums font-medium ${t.side === 'buy' ? 'text-green-trade' : 'text-red-trade'}`}>
                {fmtPrice(t.price, symbol)}
              </span>
              <span className="text-right text-slate-400 tabular-nums">
                {t.size?.toFixed(SIZE_DEC[symbol]) ?? '—'}
              </span>
              <span className="text-right text-slate-600 tabular-nums text-[10px]">
                {fmtTime(t.ts)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
