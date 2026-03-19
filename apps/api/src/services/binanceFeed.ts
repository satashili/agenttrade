import WebSocket from 'ws';
import { Server as SocketServer } from 'socket.io';
import { ALL_SYMBOLS, SPOT_SYMBOLS, EQUITY_SYMBOLS } from '@agenttrade/types';
import { getBroadcaster } from './broadcastThrottler.js';

const SPOT_PAIRS: Record<string, string> = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
};

const EQUITY_PAIRS: Record<string, string> = {
  TSLA: 'tslausdt',
  AMZN: 'amznusdt',
  COIN: 'coinusdt',
  MSTR: 'mstrusdt',
  INTC: 'intcusdt',
  HOOD: 'hoodusdt',
  CRCL: 'crclusdt',
  PLTR: 'pltrusdt',
};

// Combined lookup for symbol resolution
const ALL_PAIRS: Record<string, string> = { ...SPOT_PAIRS, ...EQUITY_PAIRS };

export interface MarketStats {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  changePct24h: number;
  volume24h: number;
}

// In-memory market data store
class MarketDataStore {
  prices: Record<string, number> = {};
  stats: Record<string, MarketStats> = {};
  // Snapshot of last complete price set (all symbols present)
  private lastCompletePrices: Record<string, number> = {};

  getPrices(): Record<string, number> {
    // If current prices cover all symbols, update the snapshot
    const hasAll = ALL_SYMBOLS.every(s => s in this.prices);
    if (hasAll) {
      this.lastCompletePrices = { ...this.prices };
      return this.lastCompletePrices;
    }
    // If we have a previous complete snapshot, use it as base and overlay any current prices
    if (Object.keys(this.lastCompletePrices).length > 0) {
      return { ...this.lastCompletePrices, ...this.prices };
    }
    // No complete snapshot yet — return whatever we have
    return { ...this.prices };
  }

  getStats(): Record<string, MarketStats> {
    return { ...this.stats };
  }
}

export const marketData = new MarketDataStore();

export class BinanceFeed {
  private spotWs: WebSocket | null = null;
  private futuresWs: WebSocket | null = null;
  private reconnectDelay: Record<string, number> = { spot: 1000, futures: 1000 };
  private io!: SocketServer;

  async connect(io: SocketServer) {
    this.io = io;
    this.connectSpot();
    this.connectFutures();
  }

  private connectSpot() {
    const streams = SPOT_SYMBOLS.map(s => `${SPOT_PAIRS[s]}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.spotWs = new WebSocket(url);

    this.spotWs.on('open', () => {
      console.log('[BinanceFeed] Spot connected');
      this.reconnectDelay.spot = 1000;
    });

    this.spotWs.on('message', (rawData: Buffer) => {
      try {
        const msg = JSON.parse(rawData.toString());
        if (msg.stream && msg.data) {
          this.handleTicker(msg.data);
        }
      } catch { /* ignore */ }
    });

    this.spotWs.on('close', () => {
      console.warn('[BinanceFeed] Spot disconnected. Reconnecting in', this.reconnectDelay.spot, 'ms');
      setTimeout(() => {
        this.reconnectDelay.spot = Math.min(this.reconnectDelay.spot * 2, 30000);
        this.connectSpot();
      }, this.reconnectDelay.spot);
    });

    this.spotWs.on('error', (err: Error) => {
      console.error('[BinanceFeed] Spot WS error:', err.message);
      this.spotWs?.terminate();
    });
  }

  private connectFutures() {
    const streams = EQUITY_SYMBOLS.map(s => `${EQUITY_PAIRS[s]}@ticker`).join('/');
    const url = `wss://fstream.binance.com/stream?streams=${streams}`;

    this.futuresWs = new WebSocket(url);

    this.futuresWs.on('open', () => {
      console.log('[BinanceFeed] Futures connected');
      this.reconnectDelay.futures = 1000;
    });

    this.futuresWs.on('message', (rawData: Buffer) => {
      try {
        const msg = JSON.parse(rawData.toString());
        if (msg.stream && msg.data) {
          this.handleTicker(msg.data);
        }
      } catch { /* ignore */ }
    });

    this.futuresWs.on('close', () => {
      console.warn('[BinanceFeed] Futures disconnected. Reconnecting in', this.reconnectDelay.futures, 'ms');
      setTimeout(() => {
        this.reconnectDelay.futures = Math.min(this.reconnectDelay.futures * 2, 30000);
        this.connectFutures();
      }, this.reconnectDelay.futures);
    });

    this.futuresWs.on('error', (err: Error) => {
      console.error('[BinanceFeed] Futures WS error:', err.message);
      this.futuresWs?.terminate();
    });
  }

  private handleTicker(d: any) {
    const pairUpper = (d.s as string || '').toUpperCase();
    const symbol = ALL_SYMBOLS.find(s => pairUpper === `${s}USDT`);
    if (!symbol) return;

    const price = parseFloat(d.c);
    const open24h = parseFloat(d.o);
    const high24h = parseFloat(d.h);
    const low24h = parseFloat(d.l);
    const change24h = parseFloat(d.p);
    const changePct24h = parseFloat(d.P);
    const volume24h = parseFloat(d.q);

    marketData.prices[symbol] = price;
    marketData.stats[symbol] = {
      price,
      open24h,
      high24h,
      low24h,
      change24h,
      changePct24h,
      volume24h,
    };

    // Queue price for batched broadcast (flushed every 500ms)
    getBroadcaster().pushPrice(symbol, price);
  }
}
