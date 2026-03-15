'use client';
import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts';
import { useBinanceKline, type TimeframeKey } from '@/hooks/useBinanceWS';

interface Props {
  symbol: 'BTC' | 'ETH' | 'SOL';
  height?: number;
}

const INTERVALS: TimeframeKey[] = ['1m', '5m', '15m', '1h', '4h'];

export function CandleChart({ symbol, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [interval, setInterval_] = useState<TimeframeKey>('1h');

  const { klines, loading } = useBinanceKline(symbol, interval);

  // Create / destroy chart when symbol or interval changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }

    const w = container.clientWidth;
    const h = height || container.clientHeight;
    if (w < 10 || h < 10) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0B0E11' },
        textColor: '#848E9C',
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1c2230' },
        horzLines: { color: '#1c2230' },
      },
      crosshair: {
        vertLine: { color: '#F0B90B40', style: 2, labelBackgroundColor: '#F0B90B' },
        horzLine: { color: '#F0B90B40', style: 2, labelBackgroundColor: '#F0B90B' },
      },
      rightPriceScale: { borderColor: '#1c2230', scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { borderColor: '#1c2230', timeVisible: true, secondsVisible: false },
      width: w,
      height: h,
    });

    chartRef.current = chart;

    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: '#0ECB81',
      downColor: '#F6465D',
      borderUpColor: '#0ECB81',
      borderDownColor: '#F6465D',
      wickUpColor: '#0ECB81',
      wickDownColor: '#F6465D',
    });

    volumeSeriesRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth;
      const nh = height || container.clientHeight;
      if (nw > 10 && nh > 10) chart.resize(nw, nh);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, height]);

  // Feed klines into chart
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || klines.length === 0) return;

    const candleData: CandlestickData[] = klines.map(k => ({
      time: k.time as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    const volumeData: HistogramData[] = klines.map(k => ({
      time: k.time as Time,
      value: k.volume,
      color: k.close >= k.open ? 'rgba(14,203,129,0.3)' : 'rgba(246,70,93,0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [klines]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Interval selector */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/40 shrink-0 bg-[#0B0E11]">
        <span className="text-[10px] text-slate-500 mr-2">Interval</span>
        {INTERVALS.map(iv => (
          <button
            key={iv}
            onClick={() => setInterval_(iv)}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
              interval === iv
                ? 'bg-[#F0B90B]/20 text-[#F0B90B] font-semibold'
                : 'text-slate-500 hover:text-slate-300 hover:bg-[#1c2230]'
            }`}
          >
            {iv}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600">{symbol}/USDT</span>
      </div>

      {/* Chart container */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0B0E11]/70 text-slate-500 text-xs">
            Loading chart data...
          </div>
        )}
      </div>
    </div>
  );
}
