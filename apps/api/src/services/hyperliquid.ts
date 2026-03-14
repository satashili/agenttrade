import WebSocket from 'ws';
import Redis from 'ioredis';
import { Server as SocketServer } from 'socket.io';

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const SYMBOLS = ['BTC', 'ETH', 'SOL'];
const CANDLE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class HyperliquidFeed {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private redis!: Redis;
  private io!: SocketServer;

  // In-memory current bars for live candle updates
  private currentBars: Record<string, Record<string, OHLCVBar>> = {};
  // Track 24h open price
  private open24h: Record<string, number> = {};

  connect(redis: Redis, io: SocketServer) {
    this.redis = redis;
    this.io = io;
    this.initBars();
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      console.log('[Hyperliquid] Connected');
      this.reconnectDelay = 1000;

      // Subscribe to all mid prices
      this.ws!.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'allMids' },
      }));

      // Subscribe to candle data for each symbol
      for (const symbol of SYMBOLS) {
        this.ws!.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'candle', coin: symbol, interval: '1m' },
        }));
      }

      this.startHeartbeat();
    });

    this.ws.on('message', async (rawData: Buffer) => {
      try {
        const msg = JSON.parse(rawData.toString());
        await this.handleMessage(msg);
      } catch (err) {
        // Ignore parse errors
      }
    });

    this.ws.on('close', () => {
      console.warn('[Hyperliquid] Disconnected. Reconnecting in', this.reconnectDelay, 'ms');
      this.stopHeartbeat();
      setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this.connect(redis, io);
      }, this.reconnectDelay);
    });

    this.ws.on('error', (err: Error) => {
      console.error('[Hyperliquid] WS error:', err.message);
      this.ws?.terminate();
    });
  }

  private async handleMessage(msg: any) {
    if (!msg.channel || !msg.data) return;

    if (msg.channel === 'allMids') {
      await this.handlePrices(msg.data.mids);
    } else if (msg.channel === 'candle') {
      await this.handleCandle(msg.data);
    } else if (msg.channel === 'pong') {
      // heartbeat response, ignore
    }
  }

  private async handlePrices(mids: Record<string, string>) {
    const prices: Record<string, number> = {};

    for (const symbol of SYMBOLS) {
      if (mids[symbol]) {
        prices[symbol] = parseFloat(mids[symbol]);
      }
    }

    if (Object.keys(prices).length === 0) return;

    // 1. Write to Redis
    const pipeline = this.redis.pipeline();
    pipeline.hset('market:prices', prices as any);
    pipeline.expire('market:prices', 15);

    // Update 24h stats
    for (const [symbol, price] of Object.entries(prices)) {
      const open = this.open24h[symbol] || price;
      const change = price - open;
      const changePct = open > 0 ? (change / open) * 100 : 0;

      pipeline.hset(`market:stats:${symbol}`, {
        price: price.toString(),
        open24h: open.toString(),
        change24h: change.toString(),
        changePct24h: changePct.toFixed(4),
      });
    }

    await pipeline.exec();

    // 2. Broadcast to all frontend clients
    this.io.emit('prices', prices);

    // 3. Update leaderboard scores based on new prices
    await this.updateLeaderboard(prices);
  }

  private async handleCandle(candle: any) {
    const symbol = candle.s;
    const interval = candle.i;

    if (!SYMBOLS.includes(symbol) || !CANDLE_INTERVALS.includes(interval)) return;

    const bar: OHLCVBar = {
      time: Math.floor(candle.t / 1000),
      open: parseFloat(candle.o),
      high: parseFloat(candle.h),
      low: parseFloat(candle.l),
      close: parseFloat(candle.c),
      volume: parseFloat(candle.v),
    };

    const cacheKey = `candles:${symbol}:${interval}`;
    const cached = await this.redis.get(cacheKey);
    let candles: OHLCVBar[] = cached ? JSON.parse(cached) : [];

    // Update or append
    if (candles.length > 0 && candles[candles.length - 1].time === bar.time) {
      candles[candles.length - 1] = bar;
    } else {
      candles.push(bar);
      // Keep last 500 candles
      if (candles.length > 500) candles = candles.slice(-500);
    }

    await this.redis.setex(cacheKey, 3600, JSON.stringify(candles));

    // Track 24h open from daily candle
    if (interval === '1d' && bar.time) {
      this.open24h[symbol] = bar.open;
    }
  }

  private async updateLeaderboard(prices: Record<string, number>) {
    // Get all agents with accounts and compute total value
    // This is a lightweight scan — in production you'd batch this
    const accounts = await (this.redis as any).keys('leaderboard:agent:*');
    // Leaderboard is updated by the matching worker; here we just re-score
    // based on latest prices via a background job (see matchingWorker.ts)
  }

  private initBars() {
    for (const symbol of SYMBOLS) {
      this.currentBars[symbol] = {};
    }
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
