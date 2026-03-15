'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useMarketStore } from '@/lib/store';

interface Props {
  symbol: 'BTC' | 'ETH' | 'SOL';
  height?: number;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = typeof INTERVALS[number];

const INTERVAL_SECONDS: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export function CandleChart({ symbol, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<any>(null);
  const [interval, setInterval_] = useState<Interval>('1h');
  const { prices } = useMarketStore();

  // Initialize chart
  const initChart = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up old chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBarRef.current = null;
    }

    const w = container.clientWidth;
    const h = height || container.clientHeight;

    // Don't create with 0 dimensions — ResizeObserver will catch it later
    if (w < 10 || h < 10) return;

    chartRef.current = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f1117' },
        textColor: '#64748b',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1f2d4020' },
        horzLines: { color: '#1f2d4020' },
      },
      crosshair: {
        vertLine: { color: '#6366f140', style: 2, labelBackgroundColor: '#6366f1' },
        horzLine: { color: '#6366f140', style: 2, labelBackgroundColor: '#6366f1' },
      },
      rightPriceScale: { borderColor: '#1f2d40', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#1f2d40', timeVisible: true, secondsVisible: false },
      width: w,
      height: h,
    });

    seriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // Fetch historical candles
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    fetch(`${apiUrl}/api/v1/market/candles?symbol=${symbol}&interval=${interval}`)
      .then(r => r.ok ? r.json() : [])
      .then((candles: any[]) => {
        if (candles.length > 0 && seriesRef.current) {
          seriesRef.current.setData(candles);
          lastBarRef.current = candles[candles.length - 1];
          chartRef.current?.timeScale().fitContent();
        }
      })
      .catch(() => {});
  }, [symbol, height, interval]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Try init immediately
    initChart();

    // ResizeObserver handles: initial layout (if 0-height on first frame) + window resize
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = height || container.clientHeight;
      if (newW < 10 || newH < 10) return;

      if (!chartRef.current) {
        // Chart wasn't created yet because container had no size — init now
        initChart();
      } else {
        chartRef.current.resize(newW, newH);
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        lastBarRef.current = null;
      }
    };
  }, [initChart]);

  // Live price updates
  useEffect(() => {
    const price = prices[symbol];
    if (!price || !seriesRef.current) return;

    const now = Math.floor(Date.now() / 1000);
    const secs = INTERVAL_SECONDS[interval];
    const barTime = (Math.floor(now / secs) * secs) as UTCTimestamp;

    if (lastBarRef.current && lastBarRef.current.time === barTime) {
      const updated = {
        ...lastBarRef.current,
        close: price,
        high: Math.max(lastBarRef.current.high, price),
        low: Math.min(lastBarRef.current.low, price),
      };
      seriesRef.current.update(updated);
      lastBarRef.current = updated;
    } else {
      const newBar = {
        time: barTime,
        open: lastBarRef.current?.close || price,
        high: price,
        low: price,
        close: price,
      };
      seriesRef.current.update(newBar);
      lastBarRef.current = newBar;
    }
  }, [prices, symbol, interval]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Interval selector toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/40 shrink-0 bg-bg">
        <span className="text-[10px] text-slate-500 mr-2">Interval</span>
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            onClick={() => setInterval_(iv)}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
              interval === iv
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-slate-500 hover:text-slate-300 hover:bg-bg-hover'
            }`}
          >
            {iv}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600">{symbol}/USDT</span>
      </div>

      {/* Chart container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden"
      />
    </div>
  );
}
