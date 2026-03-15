'use client';
import { useState } from 'react';
import { useMarketStore, useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

type Sym  = 'BTC' | 'ETH' | 'SOL';
type Side = 'buy' | 'sell';
type OType = 'market' | 'limit' | 'stop';

interface Props { symbol: Sym; }

const DECIMALS: Record<Sym, number> = { BTC: 0, ETH: 2, SOL: 2 };

function fmtPrice(p: number, sym: Sym) {
  const d = DECIMALS[sym];
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function OrderForm({ symbol }: Props) {
  const [side,    setSide]    = useState<Side>('buy');
  const [otype,   setOtype]   = useState<OType>('market');
  const [price,   setPrice]   = useState('');
  const [size,    setSize]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const { prices }      = useMarketStore();
  const { token, user } = useAuthStore();
  const currentPrice    = prices[symbol] ?? 0;

  const execPrice = otype === 'market' ? currentPrice : parseFloat(price) || 0;
  const sizeNum   = parseFloat(size) || 0;
  const total     = sizeNum && execPrice ? sizeNum * execPrice : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!sizeNum) return;

    setLoading(true);
    try {
      const body: Record<string, unknown> = { symbol, side, type: otype, size: sizeNum };
      if (otype === 'limit') body.price     = parseFloat(price);
      if (otype === 'stop')  body.stopPrice = parseFloat(price);
      await api.post('/api/v1/orders', body);
      setSuccess(`${side === 'buy' ? 'Buy' : 'Sell'} order submitted!`);
      setSize(''); setPrice('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-b border-border shrink-0 bg-[#0B0E11]">
      {/* Buy / Sell tabs */}
      <div className="grid grid-cols-2 text-xs font-semibold">
        <button
          onClick={() => setSide('buy')}
          className={`py-2 transition-colors ${
            side === 'buy'
              ? 'text-[#0ECB81] border-b-2 border-[#0ECB81] bg-[#0ECB81]/5'
              : 'text-slate-500 hover:text-slate-300 border-b border-border'
          }`}
        >Buy</button>
        <button
          onClick={() => setSide('sell')}
          className={`py-2 transition-colors ${
            side === 'sell'
              ? 'text-[#F6465D] border-b-2 border-[#F6465D] bg-[#F6465D]/5'
              : 'text-slate-500 hover:text-slate-300 border-b border-border'
          }`}
        >Sell</button>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Order type selector */}
        <div className="flex gap-1 bg-bg-secondary rounded p-0.5">
          {(['market', 'limit', 'stop'] as OType[]).map(t => (
            <button
              key={t}
              onClick={() => setOtype(t)}
              className={`flex-1 py-1 text-xs rounded transition-colors capitalize ${
                otype === t ? 'bg-bg-hover text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >{t}</button>
          ))}
        </div>

        {!token ? (
          <div className="text-center py-5 space-y-2">
            <p className="text-slate-500 text-xs">Login as an agent to trade</p>
            <a
              href="/login"
              className="inline-block text-xs bg-accent hover:bg-accent-hover text-white px-4 py-1.5 rounded transition-colors"
            >Login</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-2">
            {/* Available balance hint */}
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Avail.</span>
              <span className="text-slate-400">{user?.displayName ?? user?.name ?? 'Agent'}</span>
            </div>

            {/* Price input for limit / stop */}
            {otype !== 'market' && (
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">
                  {otype === 'stop' ? 'Stop Price' : 'Price'} (USDT)
                </label>
                <input
                  type="number" value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder={currentPrice ? fmtPrice(currentPrice, symbol) : '0'}
                  className="w-full bg-bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent tabular-nums"
                  step="any" min="0"
                />
              </div>
            )}

            {/* Market price hint */}
            {otype === 'market' && (
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500">Market Price</span>
                <span className="text-slate-300 tabular-nums">≈ ${fmtPrice(currentPrice, symbol)}</span>
              </div>
            )}

            {/* Size */}
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Amount ({symbol})</label>
              <input
                type="number" value={size}
                onChange={e => setSize(e.target.value)}
                placeholder="0.00"
                className="w-full bg-bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent tabular-nums"
                step="any" min="0"
              />
            </div>

            {/* Total */}
            {total !== null && (
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500">Total</span>
                <span className="text-slate-300 tabular-nums">
                  ≈ ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {error   && <p className="text-[11px] text-red-trade">{error}</p>}
            {success && <p className="text-[11px] text-green-trade">{success}</p>}

            <button
              type="submit"
              disabled={loading || !sizeNum || (otype !== 'market' && !parseFloat(price))}
              className={`w-full py-2 rounded text-xs font-bold transition-colors disabled:opacity-30 ${
                side === 'buy'
                  ? 'bg-[#0ECB81] hover:bg-[#0ECB81]/80 text-black'
                  : 'bg-[#F6465D] hover:bg-[#F6465D]/80 text-white'
              }`}
            >
              {loading ? 'Submitting…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
