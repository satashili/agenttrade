'use client';
import { useState, useCallback, useEffect } from 'react';
import { SymbolSidebar } from '@/components/trade/SymbolSidebar';
import { CandleChart } from '@/components/charts/CandleChart';
import { OrderBook } from '@/components/trade/OrderBook';
import { OrderForm } from '@/components/trade/OrderForm';
import { RecentTrades } from '@/components/trade/RecentTrades';
import { BottomPanel } from '@/components/trade/BottomPanel';
import { TickerBar } from '@/components/trade/TickerBar';
import { StatusBar } from '@/components/trade/StatusBar';
import { NewsTicker } from '@/components/trade/NewsTicker';
import { MarketStats } from '@/components/trade/MarketStats';
import { ResizeHandle } from '@/components/trade/ResizeHandle';

type Sym = 'BTC' | 'ETH' | 'TSLA' | 'AMZN' | 'COIN' | 'MSTR' | 'INTC' | 'HOOD' | 'CRCL' | 'PLTR';
type RightTab = 'orderbook' | 'stats';

export default function TradePage() {
  const [symbol, setSymbol] = useState<Sym>('TSLA');
  const [rightTab, setRightTab] = useState<RightTab>('orderbook');
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window === 'undefined') return 150;
    return Number(localStorage.getItem('trade:leftWidth')) || 150;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    if (typeof window === 'undefined') return 300;
    return Number(localStorage.getItem('trade:rightWidth')) || 300;
  });
  const [bottomHeight, setBottomHeight] = useState(() => {
    if (typeof window === 'undefined') return 220;
    return Number(localStorage.getItem('trade:bottomHeight')) || 220;
  });

  useEffect(() => { localStorage.setItem('trade:leftWidth', String(leftWidth)); }, [leftWidth]);
  useEffect(() => { localStorage.setItem('trade:rightWidth', String(rightWidth)); }, [rightWidth]);
  useEffect(() => { localStorage.setItem('trade:bottomHeight', String(bottomHeight)); }, [bottomHeight]);

  const onResizeLeft = useCallback((delta: number) => {
    setLeftWidth(w => Math.max(48, Math.min(260, w + delta)));
  }, []);

  const onResizeRight = useCallback((delta: number) => {
    setRightWidth(w => Math.max(200, Math.min(500, w - delta)));
  }, []);

  const onResizeBottom = useCallback((delta: number) => {
    setBottomHeight(h => Math.max(100, Math.min(600, h - delta)));
  }, []);

  return (
    <div className="h-full flex flex-col bg-bg text-slate-200 overflow-hidden" style={{ overscrollBehaviorX: 'none', touchAction: 'pan-y' }}>
      {/* StatusBar: full width, above everything */}
      <StatusBar />

      {/* NewsTicker: scrolling trade commentary */}
      <NewsTicker />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Symbol list */}
        <div style={{ width: leftWidth }} className="shrink-0">
          <SymbolSidebar selectedSymbol={symbol} onSelect={setSymbol} width={leftWidth} />
        </div>

        <ResizeHandle onResize={onResizeLeft} />

        {/* Center: TickerBar + Chart + bottom panel */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TickerBar symbol={symbol} />
          <div className="flex-1 min-h-0">
            <CandleChart symbol={symbol} />
          </div>
          <ResizeHandle direction="horizontal" onResize={onResizeBottom} />
          <BottomPanel symbol={symbol} height={bottomHeight} />
        </div>

        <ResizeHandle onResize={onResizeRight} />

        {/* Right: Tabbed panel */}
        <div style={{ width: rightWidth }} className="shrink-0 flex flex-col overflow-hidden bg-bg">
          {/* Tab headers */}
          <div className="flex border-b border-border shrink-0 bg-bg-secondary">
            {([
              { key: 'orderbook', label: 'Book' },
              { key: 'stats', label: 'Stats' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setRightTab(tab.key)}
                className={`flex-1 text-[11px] py-2 font-medium transition-colors ${
                  rightTab === tab.key
                    ? 'text-[#1E6FFF] border-b-2 border-[#1E6FFF]'
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
          {rightTab === 'stats' && <MarketStats />}
        </div>
      </div>
    </div>
  );
}
