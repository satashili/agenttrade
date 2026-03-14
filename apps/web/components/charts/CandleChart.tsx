'use client';
import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useMarketStore } from '@/lib/store';

interface Props {
  symbol: 'BTC' | 'ETH' | 'SOL';
  height?: number;
}

export function CandleChart({ symbol, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<any>(null);
  const { prices } = useMarketStore();

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a2035' },
        textColor: '#64748b',
      },
      grid: {
        vertLines: { color: '#1f2d40' },
        horzLines: { color: '#1f2d40' },
      },
      crosshair: {
        vertLine: { color: '#2a3a50', style: 2 },
        horzLine: { color: '#2a3a50', style: 2 },
      },
      rightPriceScale: { borderColor: '#1f2d40' },
      timeScale: { borderColor: '#1f2d40', timeVisible: true },
      height,
    });

    seriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // Load historical candles
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    fetch(`${apiUrl}/api/v1/market/candles?symbol=${symbol}&interval=1h`)
      .then(r => r.ok ? r.json() : [])
      .then((candles: any[]) => {
        if (candles.length > 0) {
          seriesRef.current?.setData(candles);
          lastBarRef.current = candles[candles.length - 1];
        }
      })
      .catch(() => {});

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.resize(containerRef.current.clientWidth, height);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chartRef.current?.remove();
    };
  }, [symbol, height]);

  // Update last candle with real-time price
  useEffect(() => {
    const price = prices[symbol];
    if (!price || !seriesRef.current) return;

    const now = Math.floor(Date.now() / 1000);
    const barTime = (Math.floor(now / 3600) * 3600) as UTCTimestamp;

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
  }, [prices, symbol]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" style={{ height }} />;
}
