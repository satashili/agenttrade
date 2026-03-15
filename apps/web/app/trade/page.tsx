'use client';
import { useState } from 'react';
import { SymbolSidebar } from '@/components/trade/SymbolSidebar';
import { CandleChart } from '@/components/charts/CandleChart';
import { OrderBook } from '@/components/trade/OrderBook';
import { OrderForm } from '@/components/trade/OrderForm';
import { RecentTrades } from '@/components/trade/RecentTrades';
import { BottomPanel } from '@/components/trade/BottomPanel';
import { TickerBar } from '@/components/trade/TickerBar';
import { StatusBar } from '@/components/trade/StatusBar';
import { NewsTicker } from '@/components/trade/NewsTicker';
import { ChatPanel } from '@/components/trade/ChatPanel';
import { MarketStats } from '@/components/trade/MarketStats';

type Sym = 'BTC' | 'ETH' | 'SOL';
type RightTab = 'orderbook' | 'chat' | 'stats';

export default function TradePage() {
  const [symbol, setSymbol] = useState<Sym>('BTC');
  const [rightTab, setRightTab] = useState<RightTab>('orderbook');

  return (
    <div className="h-full flex flex-col bg-bg text-slate-200 overflow-hidden">
      {/* StatusBar: full width, above everything */}
      <StatusBar />

      {/* NewsTicker: scrolling trade commentary */}
      <NewsTicker />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Symbol list */}
        <SymbolSidebar selectedSymbol={symbol} onSelect={setSymbol} />

        {/* Center: TickerBar + Chart + bottom panel */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-x border-border">
          <TickerBar symbol={symbol} />
          <div className="flex-1 min-h-0">
            <CandleChart symbol={symbol} />
          </div>
          <BottomPanel symbol={symbol} />
        </div>

        {/* Right: Tabbed panel */}
        <div className="w-[300px] shrink-0 flex flex-col overflow-hidden bg-[#0B0E11]">
          {/* Tab headers */}
          <div className="flex border-b border-border shrink-0 bg-[#12161c]">
            {([
              { key: 'orderbook', label: 'Book' },
              { key: 'chat', label: 'Chat' },
              { key: 'stats', label: 'Stats' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setRightTab(tab.key)}
                className={`flex-1 text-[11px] py-2 font-medium transition-colors ${
                  rightTab === tab.key
                    ? 'text-[#F0B90B] border-b-2 border-[#F0B90B]'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {rightTab === 'orderbook' && (
            <>
              <OrderBook symbol={symbol} />
              <OrderForm symbol={symbol} />
              <RecentTrades symbol={symbol} />
            </>
          )}
          {rightTab === 'chat' && <ChatPanel />}
          {rightTab === 'stats' && <MarketStats />}
        </div>
      </div>
    </div>
  );
}
