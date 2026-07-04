import { SPOT_SYMBOLS } from '@agenttrade/types';

const klineCache = new Map<string, { closes: number[]; candles: Array<{ high: number; low: number; close: number }>; fetchedAt: number }>();
const KLINE_TTL = 60_000;

const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  TSLA: 'TSLAUSDT',
  AMZN: 'AMZNUSDT',
  COIN: 'COINUSDT',
  MSTR: 'MSTRUSDT',
  INTC: 'INTCUSDT',
  HOOD: 'HOODUSDT',
  CRCL: 'CRCLUSDT',
  PLTR: 'PLTRUSDT',
};

function isSpot(symbol: string): boolean {
  return (SPOT_SYMBOLS as readonly string[]).includes(symbol);
}

export async function fetchKlines(
  symbol: string,
  interval = '1h',
  limit = 100
): Promise<{ closes: number[]; candles: Array<{ high: number; low: number; close: number }> }> {
  const cacheKey = `${symbol}:${interval}`;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < KLINE_TTL) {
    return { closes: cached.closes, candles: cached.candles };
  }

  const pair = BINANCE_PAIRS[symbol];
  if (!pair) return { closes: [], candles: [] };

  const base = isSpot(symbol)
    ? 'https://api.binance.com/api/v3'
    : 'https://fapi.binance.com/fapi/v1';

  try {
    const res = await fetch(`${base}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return cached ? { closes: cached.closes, candles: cached.candles } : { closes: [], candles: [] };
    const data = await res.json() as any[];
    const closes = data.map((k: any) => parseFloat(k[4]));
    const candles = data.map((k: any) => ({
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
    klineCache.set(cacheKey, { closes, candles, fetchedAt: Date.now() });
    return { closes, candles };
  } catch {
    return cached ? { closes: cached.closes, candles: cached.candles } : { closes: [], candles: [] };
  }
}
