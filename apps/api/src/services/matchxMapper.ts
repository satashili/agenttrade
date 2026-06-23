import { ALL_SYMBOLS, type Symbol as AgentSymbol } from '@agenttrade/types';

export type AgentOrderSide = 'buy' | 'sell';
export type AgentOrderType = 'market' | 'limit' | 'stop';

const SYMBOL_TO_MATCHX: Record<AgentSymbol, string> = {
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

const MATCHX_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_MATCHX).map(([symbol, matchxSymbol]) => [matchxSymbol, symbol])
) as Record<string, AgentSymbol>;

export function matchxEnabled(): boolean {
  return process.env.MATCHX_ENABLED !== 'false';
}

export function supportedAgentSymbols(): AgentSymbol[] {
  const raw = process.env.MATCHX_SUPPORTED_SYMBOLS?.trim();
  if (!raw) return [...ALL_SYMBOLS];

  const requested = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  return requested.filter((s): s is AgentSymbol =>
    (ALL_SYMBOLS as readonly string[]).includes(s)
  );
}

export function assertSupportedAgentSymbol(symbol: string): asserts symbol is AgentSymbol {
  if (!(ALL_SYMBOLS as readonly string[]).includes(symbol)) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }
  if (!supportedAgentSymbols().includes(symbol as AgentSymbol)) {
    throw new Error(`Symbol ${symbol} is not enabled for MatchX`);
  }
}

export function toMatchxSymbol(symbol: string): string {
  assertSupportedAgentSymbol(symbol);
  return SYMBOL_TO_MATCHX[symbol];
}

export function fromMatchxSymbol(matchxSymbol: string): AgentSymbol {
  const normalized = matchxSymbol.toUpperCase();
  const symbol = MATCHX_TO_SYMBOL[normalized];
  if (!symbol) {
    throw new Error(`Unsupported MatchX symbol: ${matchxSymbol}`);
  }
  return symbol;
}

export function toMatchxOrderSide(side: AgentOrderSide): 'BUY' | 'SELL' {
  return side === 'buy' ? 'BUY' : 'SELL';
}

export function fromMatchxOrderSide(side: string | number): AgentOrderSide {
  if (side === 'BUY' || side === 1) return 'buy';
  if (side === 'SELL' || side === 2) return 'sell';
  throw new Error(`Unsupported MatchX side: ${side}`);
}

export function toMatchxOrderType(type: AgentOrderType): 'MARKET' | 'LIMIT' | 'STOP_MARKET' {
  if (type === 'market') return 'MARKET';
  if (type === 'limit') return 'LIMIT';
  return 'STOP_MARKET';
}

export function fromMatchxOrderType(type: string | number): AgentOrderType {
  if (type === 'MARKET' || type === 1) return 'market';
  if (type === 'LIMIT' || type === 4) return 'limit';
  if (type === 'STOP_MARKET' || type === 2) return 'stop';
  throw new Error(`Unsupported MatchX order type: ${type}`);
}

export function fromMatchxOrderStatus(status: string | number): 'pending' | 'filled' | 'cancelled' | 'failed' {
  if (status === 'NEW' || status === 'TRIGGERED' || status === 'PARTIALLY_FILLED' || status === 1 || status === 2 || status === 4) {
    return 'pending';
  }
  if (status === 'FILLED' || status === 3) return 'filled';
  if (status === 'CANCELLED' || status === 5) return 'cancelled';
  return 'failed';
}

export function sideFromPositionIntent(orderSide: AgentOrderSide, currentSize: number): 'LONG' | 'SHORT' {
  if (orderSide === 'buy') {
    return currentSize < 0 ? 'SHORT' : 'LONG';
  }
  return currentSize > 0 ? 'LONG' : 'SHORT';
}

export function defaultMatchxLeverage(): number {
  const parsed = Number(process.env.MATCHX_DEFAULT_LEVERAGE || '5');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function initialMatchxBalance(): number {
  const parsed = Number(process.env.MATCHX_INITIAL_BALANCE || '100000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100000;
}
