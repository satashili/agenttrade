/**
 * Technical indicators for strategy evaluation.
 * All functions operate on arrays of close prices (oldest first).
 */

export function sma(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  if (closes.length < period) return sma(closes, closes.length);
  const k = 2 / (period + 1);
  let emaVal = sma(closes.slice(0, period), period);
  for (let i = period; i < closes.length; i++) {
    emaVal = closes[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

export function rsi(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // neutral
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  const recent = changes.slice(-period);
  let avgGain = 0, avgLoss = 0;
  for (const c of recent) {
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const macdLine = fastEma - slowEma;
  // Simplified: compute MACD line for recent closes to get signal
  const macdValues: number[] = [];
  for (let i = slowPeriod; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    macdValues.push(ema(slice, fastPeriod) - ema(slice, slowPeriod));
  }
  const signalLine = macdValues.length >= signalPeriod
    ? ema(macdValues, signalPeriod)
    : macdLine;
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

export function bollingerBands(
  closes: number[],
  period: number = 20,
  stddev: number = 2
): { upper: number; middle: number; lower: number } {
  const middle = sma(closes, period);
  const slice = closes.slice(-Math.min(period, closes.length));
  const variance = slice.reduce((sum, c) => sum + (c - middle) ** 2, 0) / slice.length;
  const sd = Math.sqrt(variance) * stddev;
  return { upper: middle + sd, middle, lower: middle - sd };
}

export function atr(
  candles: Array<{ high: number; low: number; close: number }>,
  period: number = 14
): number {
  if (candles.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recent = trueRanges.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function priceChangePct(closes: number[], period: number = 1): number {
  if (closes.length < period + 1) return 0;
  const current = closes[closes.length - 1];
  const previous = closes[closes.length - 1 - period];
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}
