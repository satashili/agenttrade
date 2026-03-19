import { SPOT_SYMBOLS } from '@agenttrade/types';
import type { IndicatorCondition, ExitConditions, RiskLimits, EntryAction } from '@agenttrade/types';
import * as ind from './indicators.js';

// K-line cache
const klineCache = new Map<string, { closes: number[]; candles: Array<{high:number;low:number;close:number}>; fetchedAt: number }>();
const KLINE_TTL = 60_000; // 60 seconds

const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT',
  TSLA: 'TSLAUSDT', AMZN: 'AMZNUSDT', COIN: 'COINUSDT', MSTR: 'MSTRUSDT',
  INTC: 'INTCUSDT', HOOD: 'HOODUSDT', CRCL: 'CRCLUSDT', PLTR: 'PLTRUSDT',
};

function isSpot(symbol: string): boolean {
  return (SPOT_SYMBOLS as readonly string[]).includes(symbol);
}

export async function fetchKlines(symbol: string, interval: string = '1h', limit: number = 100): Promise<{ closes: number[]; candles: Array<{high:number;low:number;close:number}> }> {
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

export function computeIndicator(
  indicator: string,
  params: Record<string, number> | undefined,
  closes: number[],
  candles: Array<{high:number;low:number;close:number}>
): number {
  const p = params || {};
  switch (indicator) {
    case 'price':
      return closes[closes.length - 1] || 0;
    case 'sma':
      return ind.sma(closes, p.period || 20);
    case 'ema':
      return ind.ema(closes, p.period || 20);
    case 'rsi':
      return ind.rsi(closes, p.period || 14);
    case 'macd': {
      const m = ind.macd(closes, p.fast || 12, p.slow || 26, p.signal || 9);
      return m.macd;
    }
    case 'bollinger': {
      const b = ind.bollingerBands(closes, p.period || 20, p.stddev || 2);
      // Return based on what's being compared - default to upper band
      return p.band === -1 ? b.lower : p.band === 0 ? b.middle : b.upper;
    }
    case 'atr':
      return ind.atr(candles, p.period || 14);
    case 'volume_change':
      return 0; // simplified for MVP
    case 'price_change':
      return ind.priceChangePct(closes, p.period || 1);
    default:
      return 0;
  }
}

export function evaluateCondition(
  condition: IndicatorCondition,
  closes: number[],
  currentPrice: number,
  candles: Array<{high:number;low:number;close:number}>
): boolean {
  const indicatorValue = computeIndicator(condition.indicator, condition.params, closes, candles);
  const compareValue = condition.compare === 'price' ? currentPrice : condition.value;

  switch (condition.operator) {
    case '<': return indicatorValue < compareValue;
    case '>': return indicatorValue > compareValue;
    case '<=': return indicatorValue <= compareValue;
    case '>=': return indicatorValue >= compareValue;
    case 'crosses_above':
    case 'crosses_below':
      // Simplified for MVP: treat as > or <
      return condition.operator === 'crosses_above'
        ? indicatorValue > compareValue
        : indicatorValue < compareValue;
    default: return false;
  }
}

export function evaluateEntryConditions(
  conditions: IndicatorCondition[],
  closes: number[],
  currentPrice: number,
  candles: Array<{high:number;low:number;close:number}>
): boolean {
  if (conditions.length === 0) return false;
  return conditions.every(c => evaluateCondition(c, closes, currentPrice, candles));
}

export function evaluateExitConditions(
  exitConditions: ExitConditions,
  closes: number[],
  currentPrice: number,
  entryPrice: number,
  positionSide: 'long' | 'short',
  candles: Array<{high:number;low:number;close:number}>
): { shouldExit: boolean; reason: string } {
  // Take profit
  if (exitConditions.takeProfit) {
    const pnlPct = positionSide === 'long'
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;
    if (pnlPct >= exitConditions.takeProfit) {
      return { shouldExit: true, reason: `take_profit: ${pnlPct.toFixed(2)}% >= ${exitConditions.takeProfit}%` };
    }
  }

  // Stop loss
  if (exitConditions.stopLoss) {
    const pnlPct = positionSide === 'long'
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;
    if (pnlPct <= -exitConditions.stopLoss) {
      return { shouldExit: true, reason: `stop_loss: ${pnlPct.toFixed(2)}% <= -${exitConditions.stopLoss}%` };
    }
  }

  // Exit signal
  if (exitConditions.exitSignal && exitConditions.exitSignal.length > 0) {
    const signalTriggered = exitConditions.exitSignal.some(c =>
      evaluateCondition(c, closes, currentPrice, candles)
    );
    if (signalTriggered) {
      return { shouldExit: true, reason: 'exit_signal triggered' };
    }
  }

  return { shouldExit: false, reason: '' };
}

export function checkRiskLimits(
  riskLimits: RiskLimits,
  dailyTrades: number,
  dailyLoss: number,
  lastTriggeredAt: Date | null
): { allowed: boolean; reason?: string } {
  if (riskLimits.maxDailyTrades && dailyTrades >= riskLimits.maxDailyTrades) {
    return { allowed: false, reason: `max_daily_trades: ${dailyTrades} >= ${riskLimits.maxDailyTrades}` };
  }
  if (riskLimits.maxDailyLoss && dailyLoss >= riskLimits.maxDailyLoss) {
    return { allowed: false, reason: `max_daily_loss: $${dailyLoss.toFixed(2)} >= $${riskLimits.maxDailyLoss}` };
  }
  if (riskLimits.cooldownSeconds && lastTriggeredAt) {
    const elapsed = (Date.now() - lastTriggeredAt.getTime()) / 1000;
    if (elapsed < riskLimits.cooldownSeconds) {
      return { allowed: false, reason: `cooldown: ${elapsed.toFixed(0)}s < ${riskLimits.cooldownSeconds}s` };
    }
  }
  return { allowed: true };
}

export function calculateOrderSize(
  entryAction: EntryAction,
  equity: number,
  currentPrice: number
): number {
  if (entryAction.sizeType === 'fixed') {
    return entryAction.size;
  }
  // percent_equity
  const tradeValue = equity * (entryAction.size / 100);
  let size = tradeValue / currentPrice;
  // Round appropriately
  if (currentPrice > 1000) size = parseFloat(size.toFixed(5)); // BTC-like
  else if (currentPrice > 100) size = parseFloat(size.toFixed(4)); // ETH-like
  else size = parseFloat(size.toFixed(2)); // stocks
  return Math.max(size, 0);
}
