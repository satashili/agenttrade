'use client';
import { useState, useEffect, useCallback } from 'react';
import { useMarketStore, useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

type Sym  = 'BTC' | 'ETH' | 'TSLA' | 'AMZN' | 'COIN' | 'MSTR' | 'INTC' | 'HOOD' | 'CRCL' | 'PLTR';
type Side = 'buy' | 'sell';
type OType = 'market' | 'limit' | 'stop';

interface Props { symbol: Sym; }

const DECIMALS: Record<Sym, number> = {
  BTC: 0, ETH: 2, TSLA: 2, AMZN: 2, COIN: 2, MSTR: 2, INTC: 2, HOOD: 2, CRCL: 2, PLTR: 2,
};

function fmtPrice(p: number, sym: Sym) {
  const d = DECIMALS[sym];
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface PositionInfo {
  size: number;
  avgCost: number;
  side: string;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  marginUsed: number;
}

interface LeverageInfo {
  maxLeverage: number;
  totalMarginUsed: number;
  availableMargin: number;
  currentLeverage: number;
}

const LEVERAGE_OPTIONS = [1, 2, 3, 5] as const;

export function OrderForm({ symbol }: Props) {
  const [side,    setSide]    = useState<Side>('buy');
  const [otype,   setOtype]   = useState<OType>('market');
  const [price,   setPrice]   = useState('');
  const [size,    setSize]    = useState('');
  const [selectedLeverage, setSelectedLeverage] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [position, setPosition] = useState<PositionInfo | null>(null);
  const [leverage, setLeverage] = useState<LeverageInfo | null>(null);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [closeResult, setCloseResult] = useState<{ pnl: number; symbol: string } | null>(null);

  const { prices }      = useMarketStore();
  const { token, user } = useAuthStore();
  const currentPrice    = prices[symbol] ?? 0;

  const execPrice = otype === 'market' ? currentPrice : parseFloat(price) || 0;
  const sizeNum   = parseFloat(size) || 0;
  const total     = sizeNum && execPrice ? sizeNum * execPrice : null;

  // Max position value at selected leverage
  const maxValue = cashBalance * selectedLeverage;
  const maxSize  = execPrice > 0 ? maxValue / execPrice : 0;

  // Fetch portfolio for current position & leverage info
  const fetchPortfolio = useCallback(async () => {
    if (!token) return;
    try {
      const p: any = await api.get('/api/v1/portfolio');
      setCashBalance(p.cashBalance || 0);
      setLeverage(p.leverage || null);
      const pos = p.positions?.[symbol];
      setPosition(pos && pos.size !== 0 ? pos : null);
    } catch { }
  }, [token, symbol]);

  useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setCloseResult(null);
    if (!sizeNum) return;

    setLoading(true);
    try {
      const body: Record<string, unknown> = { symbol, side, type: otype, size: sizeNum };
      if (otype === 'limit' || otype === 'stop') body.price = parseFloat(price);
      await api.post('/api/v1/orders', body);
      setSuccess(`${side === 'buy' ? 'Buy' : 'Sell'} ${sizeNum} ${symbol} filled`);
      setSize(''); setPrice('');
      fetchPortfolio();
    } catch (err: any) {
      setError(err.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  }

  async function closePosition() {
    if (!position) return;
    setLoading(true);
    setError(''); setSuccess(''); setCloseResult(null);
    try {
      const result: any = await api.post('/api/v1/orders/close-position', { symbol });
      const fillPrice = result?.order?.fillPrice || 0;
      const closedSize = Math.abs(position.size);
      const pnl = position.side === 'long'
        ? closedSize * (fillPrice - position.avgCost)
        : closedSize * (position.avgCost - fillPrice);
      const fee = closedSize * fillPrice * 0.001;
      setCloseResult({ pnl: pnl - fee, symbol });
      setSuccess(`Closed ${symbol} position`);
      fetchPortfolio();
    } catch (err: any) {
      setError(err.message || 'Failed to close position');
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
          className={`py-2.5 transition-colors ${
            side === 'buy'
              ? 'text-[#0ECB81] border-b-2 border-[#0ECB81] bg-[#0ECB81]/5'
              : 'text-slate-500 hover:text-slate-300 border-b border-border'
          }`}
        >Long / Buy</button>
        <button
          onClick={() => setSide('sell')}
          className={`py-2.5 transition-colors ${
            side === 'sell'
              ? 'text-[#F6465D] border-b-2 border-[#F6465D] bg-[#F6465D]/5'
              : 'text-slate-500 hover:text-slate-300 border-b border-border'
          }`}
        >Short / Sell</button>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Order type selector */}
        <div className="flex gap-1 bg-bg-secondary rounded p-0.5">
          {(['market', 'limit', 'stop'] as OType[]).map(t => (
            <button
              key={t}
              onClick={() => setOtype(t)}
              className={`flex-1 py-1.5 text-xs rounded transition-colors capitalize ${
                otype === t ? 'bg-bg-hover text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >{t}</button>
          ))}
        </div>

        {!token ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-slate-500 text-xs">Login to trade</p>
            <a
              href="/login"
              className="inline-block text-xs bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded transition-colors"
            >Login</a>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-2.5">
              {/* Balance & buying power */}
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Balance: <span className="text-slate-300 tabular-nums">${fmtUsd(cashBalance)}</span></span>
                <span>Buying Power: <span className="text-[#1E6FFF] tabular-nums font-medium">${fmtUsd(maxValue)}</span></span>
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
                    className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent tabular-nums"
                    step="any" min="0"
                  />
                </div>
              )}

              {/* Leverage selector */}
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Leverage</label>
                <div className="flex gap-1 bg-bg-secondary rounded p-0.5">
                  {LEVERAGE_OPTIONS.map(lv => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setSelectedLeverage(lv)}
                      className={`flex-1 py-1.5 text-xs rounded font-bold transition-colors ${
                        selectedLeverage === lv
                          ? 'bg-[#1E6FFF] text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >{lv}x</button>
                  ))}
                </div>
              </div>

              {/* Market price hint */}
              {otype === 'market' && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">Market Price</span>
                  <span className="text-white tabular-nums font-medium">${fmtPrice(currentPrice, symbol)}</span>
                </div>
              )}

              {/* Size */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] text-slate-500">Amount ({symbol})</label>
                  {execPrice > 0 && (
                    <span className="text-[9px] text-slate-600">
                      Max: <span className="text-slate-500 tabular-nums">{maxSize >= 1000 ? maxSize.toFixed(2) : maxSize.toFixed(4)}</span>
                    </span>
                  )}
                </div>
                <input
                  type="number" value={size}
                  onChange={e => setSize(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent tabular-nums"
                  step="any" min="0"
                />
                {/* Quick size buttons */}
                {execPrice > 0 && (
                  <div className="flex gap-1 mt-1">
                    {[25, 50, 75, 100].map(pct => {
                      const sz = maxSize * (pct / 100);
                      const formatted = sz >= 1 ? sz.toFixed(2) : sz.toFixed(4);
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setSize(formatted)}
                          className="flex-1 py-1 text-[9px] font-semibold rounded bg-bg-secondary border border-border/50 text-slate-500 hover:text-slate-300 hover:border-border transition-colors"
                        >{pct}%</button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Total */}
              {total !== null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">Total</span>
                  <span className="text-slate-300 tabular-nums">${fmtUsd(total)}</span>
                </div>
              )}

              {/* Margin required */}
              {total !== null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">Margin ({selectedLeverage}x)</span>
                  <span className="text-slate-300 tabular-nums">${fmtUsd(total / selectedLeverage)}</span>
                </div>
              )}

              {error && (
                <div className="flex items-center justify-between gap-1 text-[11px] text-red-trade bg-red-trade/10 rounded px-2 py-1">
                  <span>{error}</span>
                  <button onClick={() => setError('')} className="text-red-trade/60 hover:text-red-trade text-sm leading-none">&times;</button>
                </div>
              )}
              {success && (
                <div className="flex items-center justify-between gap-1 text-[11px] text-green-trade bg-green-trade/10 rounded px-2 py-1">
                  <span>{success}</span>
                  <button onClick={() => { setSuccess(''); setCloseResult(null); }} className="text-green-trade/60 hover:text-green-trade text-sm leading-none">&times;</button>
                </div>
              )}
              {closeResult && (
                <div className={`flex items-center justify-between gap-1 text-[11px] font-medium rounded px-2 py-1 ${closeResult.pnl >= 0 ? 'text-green-trade bg-green-trade/10' : 'text-red-trade bg-red-trade/10'}`}>
                  <span>Realized P&L: {closeResult.pnl >= 0 ? '+' : ''}${fmtUsd(closeResult.pnl)}</span>
                  <button onClick={() => setCloseResult(null)} className="opacity-60 hover:opacity-100 text-sm leading-none">&times;</button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !sizeNum || (otype !== 'market' && !parseFloat(price))}
                className={`w-full py-2.5 rounded text-sm font-bold transition-colors disabled:opacity-30 ${
                  side === 'buy'
                    ? 'bg-[#0ECB81] hover:bg-[#0ECB81]/80 text-black'
                    : 'bg-[#F6465D] hover:bg-[#F6465D]/80 text-white'
                }`}
              >
                {loading ? 'Submitting…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}
              </button>
            </form>

            {/* Current position & close button */}
            {position && (
              <div className="mt-2 p-2.5 rounded bg-bg-secondary border border-border/50 space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">Position</span>
                  <span className={`font-medium ${position.side === 'long' ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                    {position.side === 'long' ? '▲ LONG' : '▼ SHORT'} {Math.abs(position.size)} {symbol}
                  </span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">Entry</span>
                  <span className="text-slate-300 tabular-nums">${fmtPrice(position.avgCost, symbol)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">Unrealized P&L</span>
                  <span className={`tabular-nums font-medium ${position.unrealizedPnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                    {position.unrealizedPnl >= 0 ? '+' : ''}${fmtUsd(position.unrealizedPnl)} ({position.unrealizedPnlPct >= 0 ? '+' : ''}{position.unrealizedPnlPct.toFixed(2)}%)
                  </span>
                </div>
                <button
                  onClick={closePosition}
                  disabled={loading}
                  className="w-full py-1.5 rounded text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white transition-colors disabled:opacity-30 mt-1"
                >
                  {loading ? 'Closing…' : `Close ${symbol} Position`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
