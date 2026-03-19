import { Server as SocketServer } from 'socket.io';

/**
 * Batches and throttles Socket.IO broadcasts to reduce per-connection overhead.
 *
 * - prices:       merged into one object, flushed every 500ms
 * - tradeActivity: buffered, flushed every 500ms
 * - chatMessage (trade): sampled — when trade rate exceeds threshold,
 *                        replaced with a periodic summary message
 */

interface TradeActivityPayload {
  agentName: string;
  symbol: string;
  side: string;
  size: number;
  price: number;
}

interface ChatMessagePayload {
  agentName: string;
  message: string;
  ts: number;
  type?: string;
  userType?: string;
}

// How many trade chat messages per flush window before switching to summary mode
const TRADE_CHAT_THRESHOLD = 5;

// Singleton instance — set via init(), accessed via getBroadcaster()
let _instance: BroadcastThrottler | null = null;

export function initBroadcaster(io: SocketServer, intervalMs = 500): BroadcastThrottler {
  if (_instance) _instance.destroy();
  _instance = new BroadcastThrottler(io, intervalMs);
  return _instance;
}

export function getBroadcaster(): BroadcastThrottler {
  if (!_instance) throw new Error('BroadcastThrottler not initialized — call initBroadcaster() first');
  return _instance;
}

export class BroadcastThrottler {
  private io: SocketServer;
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  // Price buffer: merged by symbol
  private priceBuf: Record<string, number> = {};
  private priceDirty = false;

  // Trade activity buffer
  private tradeBuf: TradeActivityPayload[] = [];

  // Trade chat messages accumulated during this window (for summary)
  private tradeChatBuf: Array<{ agentName: string; symbol: string; side: string; size: number; price: number }> = [];

  // Non-trade chat messages pass through with slight batching
  private chatBuf: ChatMessagePayload[] = [];

  constructor(io: SocketServer, private intervalMs = 500) {
    this.io = io;
    this.flushInterval = setInterval(() => this.flush(), this.intervalMs);
  }

  /** Queue a price update (will be merged with other symbols) */
  pushPrice(symbol: string, price: number) {
    this.priceBuf[symbol] = price;
    this.priceDirty = true;
  }

  /** Queue a tradeActivity broadcast */
  pushTradeActivity(payload: TradeActivityPayload) {
    this.tradeBuf.push(payload);
  }

  /**
   * Queue a trade-type chat message for potential summarization.
   * Call this instead of io.emit('chatMessage', ...) for system trade messages.
   */
  pushTradeChat(agentName: string, symbol: string, side: string, size: number, price: number) {
    this.tradeChatBuf.push({ agentName, symbol, side, size, price });
  }

  /** Queue a regular (non-trade) chat message */
  pushChat(payload: ChatMessagePayload) {
    this.chatBuf.push(payload);
  }

  private flush() {
    // --- Prices ---
    if (this.priceDirty) {
      this.io.emit('prices', this.priceBuf);
      // Keep the buffer object — prices are a running snapshot, not per-event
      this.priceDirty = false;
    }

    // --- Trade activity ---
    if (this.tradeBuf.length > 0) {
      // Send as array so frontend can handle batch
      for (const t of this.tradeBuf) {
        this.io.emit('tradeActivity', t as any);
      }
      this.tradeBuf = [];
    }

    // --- Trade chat (with summary) ---
    if (this.tradeChatBuf.length > 0) {
      if (this.tradeChatBuf.length <= TRADE_CHAT_THRESHOLD) {
        // Low volume — send each one individually
        for (const t of this.tradeChatBuf) {
          const sideEmoji = t.side === 'buy' ? '📈' : '📉';
          const priceStr = t.price >= 1000
            ? `$${Math.round(t.price).toLocaleString()}`
            : `$${t.price.toFixed(2)}`;
          this.io.emit('chatMessage', {
            agentName: 'System',
            message: `${sideEmoji} ${t.agentName} ${t.side === 'buy' ? 'bought' : 'sold'} ${t.size} ${t.symbol} @ ${priceStr}`,
            ts: Date.now(),
            type: 'trade',
            userType: 'system',
          } as any);
        }
      } else {
        // High volume — emit a single summary
        const count = this.tradeChatBuf.length;
        // Collect unique agent names (show up to 3)
        const agents = [...new Set(this.tradeChatBuf.map(t => t.agentName))];
        const agentStr = agents.length <= 3
          ? agents.join(', ')
          : `${agents.slice(0, 3).join(', ')} and ${agents.length - 3} others`;

        this.io.emit('chatMessage', {
          agentName: 'System',
          message: `⚡ ${agentStr} completed ${count} trades in the last ${(this.intervalMs / 1000).toFixed(1)}s`,
          ts: Date.now(),
          type: 'trade',
          userType: 'system',
        } as any);
      }
      this.tradeChatBuf = [];
    }

    // --- Regular chat ---
    if (this.chatBuf.length > 0) {
      for (const msg of this.chatBuf) {
        this.io.emit('chatMessage', msg as any);
      }
      this.chatBuf = [];
    }
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}
