'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const SPOT_REST = 'https://data-api.binance.vision/api/v3';
const FUTURES_REST = 'https://fapi.binance.com/fapi/v1';
const SPOT_WS = 'wss://data-stream.binance.vision/stream?streams=';
const FUTURES_WS = 'wss://fstream.binance.com/stream?streams=';

const SPOT_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
};

const EQUITY_PAIRS: Record<string, string> = {
  TSLA: 'TSLAUSDT',
  AMZN: 'AMZNUSDT',
  COIN: 'COINUSDT',
  MSTR: 'MSTRUSDT',
  INTC: 'INTCUSDT',
  HOOD: 'HOODUSDT',
  CRCL: 'CRCLUSDT',
  PLTR: 'PLTRUSDT',
};

function isEquity(symbol: string): boolean {
  return symbol in EQUITY_PAIRS;
}

function getPair(symbol: string): string {
  return SPOT_PAIRS[symbol] || EQUITY_PAIRS[symbol] || `${symbol}USDT`;
}

function getRestBase(symbol: string): string {
  return isEquity(symbol) ? FUTURES_REST : SPOT_REST;
}

function getWsBase(symbol: string): string {
  return isEquity(symbol) ? FUTURES_WS : SPOT_WS;
}

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface BinanceOrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

export type TimeframeKey = '1m' | '5m' | '15m' | '1h' | '4h';

// ─── WebSocket Manager (Batched, per base URL) ────────────────
type StreamHandler = (data: any) => void;

class BinanceWSManager {
  private ws: WebSocket | null = null;
  private handlers: Map<string, StreamHandler> = new Map();
  private reconnectTimer: number | null = null;
  private batchTimer: number | null = null;
  private isConnected = false;
  private connectionAttempts = 0;
  private maxAttempts = 5;
  private currentStreamsUrl = '';
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  subscribe(stream: string, handler: StreamHandler) {
    this.handlers.set(stream, handler);
    this.scheduleBatchConnect();
  }

  unsubscribe(stream: string) {
    this.handlers.delete(stream);
    if (this.handlers.size === 0) {
      this.disconnect();
    }
  }

  private scheduleBatchConnect() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = window.setTimeout(() => {
      this.batchTimer = null;
      const newUrl = this.getStreamsUrl();
      if (newUrl !== this.currentStreamsUrl) {
        if (this.isConnected) {
          this.disconnect();
        }
        this.connect();
      }
    }, 150);
  }

  private getStreamsUrl(): string {
    return this.baseUrl + Array.from(this.handlers.keys()).join('/');
  }

  private connect() {
    if (this.handlers.size === 0) return;
    if (this.connectionAttempts >= this.maxAttempts) return;

    const url = this.getStreamsUrl();
    this.currentStreamsUrl = url;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.connectionAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        const stream = msg.stream;
        const data = msg.data;
        if (stream && data) {
          const handler = this.handlers.get(stream);
          if (handler) {
            handler(data);
          } else {
            this.handlers.forEach((h, key) => {
              if (stream.includes(key) || key.includes(stream)) {
                h(data);
              }
            });
          }
        }
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => {
      this.isConnected = false;
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.currentStreamsUrl = '';
      this.scheduleReconnect();
    };
  }

  private disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.currentStreamsUrl = '';
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.handlers.size === 0) return;
    this.connectionAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

const spotWsManager = new BinanceWSManager(SPOT_WS);
const futuresWsManager = new BinanceWSManager(FUTURES_WS);

function getWsManager(symbol: string): BinanceWSManager {
  return isEquity(symbol) ? futuresWsManager : spotWsManager;
}

// ─── Kline Hook ──────────────────────────────────────────────
export function useBinanceKline(symbol: string, timeframe: TimeframeKey = '1m') {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);
  const wsActiveRef = useRef(false);
  const pair = getPair(symbol);
  const pairLc = pair.toLowerCase();
  const restBase = getRestBase(symbol);

  const fetchKlines = useCallback(async () => {
    try {
      const res = await fetch(`${restBase}/klines?symbol=${pair}&interval=${timeframe}&limit=300`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const parsed: KlineData[] = data.map((d: any) => ({
          time: d[0] / 1000,
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
        }));
        setKlines(parsed);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [pair, timeframe, restBase]);

  useEffect(() => {
    setLoading(true);
    setKlines([]);
    wsActiveRef.current = false;
    fetchKlines();
  }, [fetchKlines]);

  useEffect(() => {
    const stream = `${pairLc}@kline_${timeframe}`;
    const mgr = getWsManager(symbol);

    mgr.subscribe(stream, (d) => {
      if (d?.k) {
        wsActiveRef.current = true;
        const k = d.k;
        const newCandle: KlineData = {
          time: k.t / 1000,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };
        setKlines(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].time === newCandle.time) {
            updated[lastIdx] = newCandle;
          } else {
            updated.push(newCandle);
            if (updated.length > 500) updated.shift();
          }
          return updated;
        });
      }
    });

    return () => {
      mgr.unsubscribe(stream);
      wsActiveRef.current = false;
    };
  }, [pairLc, timeframe, symbol]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!wsActiveRef.current) {
        fetchKlines();
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [fetchKlines]);

  return { klines, loading };
}

// ─── Depth Hook ──────────────────────────────────────────────
export function useBinanceDepth(symbol: string) {
  const [orderBook, setOrderBook] = useState<BinanceOrderBook>({ bids: [], asks: [] });
  const wsActiveRef = useRef(false);
  const pair = getPair(symbol);
  const pairLc = pair.toLowerCase();
  const restBase = getRestBase(symbol);

  const parseDepth = useCallback((bids: string[][], asks: string[][]) => {
    let bidTotal = 0;
    let askTotal = 0;
    setOrderBook({
      bids: bids.slice(0, 15).map((b) => {
        const qty = parseFloat(b[1]);
        bidTotal += qty;
        return { price: parseFloat(b[0]), quantity: qty, total: bidTotal };
      }),
      asks: asks.slice(0, 15).map((a) => {
        const qty = parseFloat(a[1]);
        askTotal += qty;
        return { price: parseFloat(a[0]), quantity: qty, total: askTotal };
      }),
    });
  }, []);

  const fetchDepth = useCallback(async () => {
    try {
      const res = await fetch(`${restBase}/depth?symbol=${pair}&limit=20`);
      const d = await res.json();
      if (d.bids && d.asks) {
        parseDepth(d.bids, d.asks);
      }
    } catch { /* silent */ }
  }, [pair, parseDepth, restBase]);

  useEffect(() => {
    fetchDepth();
  }, [fetchDepth]);

  useEffect(() => {
    const stream = `${pairLc}@depth20@1000ms`;
    const mgr = getWsManager(symbol);

    mgr.subscribe(stream, (d) => {
      if (d?.b && d?.a) {
        wsActiveRef.current = true;
        parseDepth(d.b, d.a);
      }
    });

    return () => {
      mgr.unsubscribe(stream);
      wsActiveRef.current = false;
    };
  }, [pairLc, parseDepth, symbol]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!wsActiveRef.current) {
        fetchDepth();
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [fetchDepth]);

  return { orderBook };
}

// ─── Aggregate Trades Hook ───────────────────────────────────
export function useBinanceAggTrades(symbol: string) {
  const [trades, setTrades] = useState<Array<{ price: number; qty: number; isBuyerMaker: boolean; time: number }>>([]);
  const wsActiveRef = useRef(false);
  const pair = getPair(symbol);
  const pairLc = pair.toLowerCase();
  const restBase = getRestBase(symbol);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`${restBase}/trades?symbol=${pair}&limit=30`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setTrades(data.map((d: any) => ({
          price: parseFloat(d.price),
          qty: parseFloat(d.qty),
          isBuyerMaker: d.isBuyerMaker,
          time: d.time,
        })).reverse());
      }
    } catch { /* silent */ }
  }, [pair, restBase]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    const stream = `${pairLc}@aggTrade`;
    const mgr = getWsManager(symbol);

    mgr.subscribe(stream, (d) => {
      if (d?.p) {
        wsActiveRef.current = true;
        setTrades(prev => {
          const newTrade = {
            price: parseFloat(d.p),
            qty: parseFloat(d.q),
            isBuyerMaker: d.m,
            time: d.T || d.E || Date.now(),
          };
          return [newTrade, ...prev].slice(0, 50);
        });
      }
    });

    return () => {
      mgr.unsubscribe(stream);
      wsActiveRef.current = false;
    };
  }, [pairLc, symbol]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!wsActiveRef.current) {
        fetchTrades();
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [fetchTrades]);

  return { trades };
}

// ─── Ticker Interface ───────────────────────────────────────
export interface TickerData {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

// ─── Ticker Hook ────────────────────────────────────────────
export function useBinanceTicker(symbol: string) {
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);
  const wsActiveRef = useRef(false);
  const lastPriceRef = useRef<number>(0);
  const pair = getPair(symbol);
  const pairLc = pair.toLowerCase();
  const restBase = getRestBase(symbol);

  const parseTicker = useCallback((d: any): TickerData => {
    return {
      symbol,
      lastPrice: parseFloat(d.c ?? d.lastPrice),
      priceChange: parseFloat(d.p ?? d.priceChange),
      priceChangePct: parseFloat(d.P ?? d.priceChangePercent),
      high24h: parseFloat(d.h ?? d.highPrice),
      low24h: parseFloat(d.l ?? d.lowPrice),
      volume24h: parseFloat(d.v ?? d.volume),
    };
  }, [symbol]);

  const updateTicker = useCallback((data: TickerData) => {
    if (lastPriceRef.current !== 0) {
      if (data.lastPrice > lastPriceRef.current) setPriceDirection('up');
      else if (data.lastPrice < lastPriceRef.current) setPriceDirection('down');
    }
    lastPriceRef.current = data.lastPrice;
    setTicker(data);
  }, []);

  const fetchTicker = useCallback(async () => {
    try {
      const res = await fetch(`${restBase}/ticker/24hr?symbol=${pair}`);
      const d = await res.json();
      if (d.lastPrice) {
        updateTicker(parseTicker(d));
      }
    } catch { /* silent */ }
  }, [pair, parseTicker, updateTicker, restBase]);

  useEffect(() => {
    lastPriceRef.current = 0;
    setTicker(null);
    setPriceDirection(null);
    wsActiveRef.current = false;
    fetchTicker();
  }, [fetchTicker]);

  useEffect(() => {
    const stream = `${pairLc}@ticker`;
    const mgr = getWsManager(symbol);

    mgr.subscribe(stream, (d) => {
      if (d?.c) {
        wsActiveRef.current = true;
        updateTicker(parseTicker(d));
      }
    });

    return () => {
      mgr.unsubscribe(stream);
      wsActiveRef.current = false;
    };
  }, [pairLc, parseTicker, updateTicker, symbol]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!wsActiveRef.current) {
        fetchTicker();
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [fetchTicker]);

  return { ticker, priceDirection };
}
