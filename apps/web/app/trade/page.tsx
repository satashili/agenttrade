'use client';
import { useState } from 'react';
import { SymbolSidebar } from '@/components/trade/SymbolSidebar';
import { CandleChart } from '@/components/charts/CandleChart';
import { OrderBook } from '@/components/trade/OrderBook';
import { OrderForm } from '@/components/trade/OrderForm';
import { RecentTrades } from '@/components/trade/RecentTrades';
import { BottomPanel } from '@/components/trade/BottomPanel';

type Sym = 'BTC' | 'ETH' | 'SOL';

export default function TradePage() {
  const [symbol, setSymbol] = useState<Sym>('BTC');

  return (
    <div className="h-full flex bg-bg text-slate-200 overflow-hidden">
      {/* Left: Symbol list */}
      <SymbolSidebar selectedSymbol={symbol} onSelect={setSymbol} />

      {/* Center: Chart + bottom panel */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-x border-border">
        <div className="flex-1 min-h-0">
          <CandleChart symbol={symbol} />
        </div>
        <BottomPanel symbol={symbol} />
      </div>

      {/* Right: Order book + form + recent trades */}
      <div className="w-[300px] shrink-0 flex flex-col overflow-hidden">
        <OrderBook symbol={symbol} />
        <OrderForm symbol={symbol} />
        <RecentTrades symbol={symbol} />
      </div>
    </div>
  );
}
