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
import { useI18n } from '@/lib/i18n';

type Sym = 'BTC' | 'ETH' | 'TSLA' | 'AMZN' | 'COIN' | 'MSTR' | 'INTC' | 'HOOD' | 'CRCL' | 'PLTR';
type RightTab = 'orderbook' | 'stats';
type MobileTab = 'chart' | 'trade' | 'activity' | 'stats';

export default function TradePage() {
  const [symbol, setSymbol] = useState<Sym>('TSLA');
  const [rightTab, setRightTab] = useState<RightTab>('orderbook');
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart');
  const [isMobile, setIsMobile] = useState(false);
  const { t } = useI18n();
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
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const onResizeLeft = useCallback((delta: number) => {
    setLeftWidth(w => Math.max(48, Math.min(260, w + delta)));
  }, []);

  const onResizeRight = useCallback((delta: number) => {
    setRightWidth(w => Math.max(200, Math.min(500, w - delta)));
  }, []);

  const onResizeBottom = useCallback((delta: number) => {
    setBottomHeight(h => Math.max(100, Math.min(600, h - delta)));
  }, []);

  if (isMobile) {
    return (
      <div className="h-full flex flex-col bg-bg text-slate-200 overflow-hidden">
        <StatusBar />
        <NewsTicker />
        <TickerBar symbol={symbol} />

        <div className="shrink-0 border-b border-border bg-[#0B0E11]">
          <div className="overflow-x-auto">
            <div className="flex min-w-max gap-1 px-2 py-2">
              {(['TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR', 'BTC', 'ETH'] as Sym[]).map((sym) => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`h-8 rounded px-3 text-xs font-bold transition-colors ${
                    symbol === sym ? 'bg-[#1E6FFF] text-white' : 'bg-bg-secondary text-slate-400'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 border-t border-border/60 text-xs font-semibold">
            {([
              ['chart', t('Chart')],
              ['trade', t('Trade')],
              ['activity', t('Activity')],
              ['stats', t('Stats')],
            ] as Array<[MobileTab, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMobileTab(key)}
                className={`py-2 transition-colors ${
                  mobileTab === key
                    ? 'border-b-2 border-[#1E6FFF] text-white'
                    : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {mobileTab === 'chart' && (
            <div className="h-full min-h-[420px]">
              <CandleChart symbol={symbol} />
            </div>
          )}
          {mobileTab === 'trade' && (
            <div className="grid gap-0">
              <OrderBook symbol={symbol} />
              <OrderForm symbol={symbol} />
              <RecentTrades symbol={symbol} />
            </div>
          )}
          {mobileTab === 'activity' && (
            <BottomPanel symbol={symbol} height={520} />
          )}
          {mobileTab === 'stats' && <MarketStats />}
        </div>
      </div>
    );
  }

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
              { key: 'orderbook', label: t('Book') },
              { key: 'stats', label: t('Stats') },
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
