import WebSocket from 'ws';
import { Server as SocketServer } from 'socket.io';

const SYMBOLS = ['BTC', 'ETH', 'SOL'];
const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  SOL: 'solusdt',
};

export interface MarketStats {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  changePct24h: number;
  volume24h: number;
}

// In-memory market data store (replaces Redis)
class MarketDataStore {
  prices: Record<string, number> = {};
  stats: Record<string, MarketStats> = {};

  getPrices(): Record<string, number> {
    return { ...this.prices };
  }

  getStats(): Record<string, MarketStats> {
    return { ...this.stats };
  }
}

export const marketData = new MarketDataStore();

export class BinanceFeed {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private io!: SocketServer;

  async connect(io: SocketServer) {
    this.io = io;
    this.connectWS();
  }

  private connectWS() {
    const streams = SYMBOLS.map(s => `${BINANCE_PAIRS[s]}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[BinanceFeed] Connected');
      this.reconnectDelay = 1000;
    });

    this.ws.on('message', (rawData: Buffer) => {
      try {
        const msg = JSON.parse(rawData.toString());
        if (msg.stream && msg.data) {
          this.handleTicker(msg.data);
        }
      } catch { /* ignore */ }
    });

    this.ws.on('close', () => {
      console.warn('[BinanceFeed] Disconnected. Reconnecting in', this.reconnectDelay, 'ms');
      setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this.connectWS();
      }, this.reconnectDelay);
    });

    this.ws.on('error', (err: Error) => {
      console.error('[BinanceFeed] WS error:', err.message);
      this.ws?.terminate();
    });
  }

  private handleTicker(d: any) {
    const pairUpper = (d.s as string || '').toUpperCase();
    const symbol = SYMBOLS.find(s => pairUpper === `${s}USDT`);
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

    // Broadcast to all frontend clients
    this.io.emit('prices', { [symbol]: price });
  }
}
