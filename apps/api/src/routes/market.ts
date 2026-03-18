import { FastifyInstance } from 'fastify';
import { marketData } from '../services/binanceFeed.js';
import { ALL_SYMBOLS, SPOT_SYMBOLS, EQUITY_SYMBOLS } from '@agenttrade/types';

// Binance pair mapping
const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT',
  TSLA: 'TSLAUSDT', AMZN: 'AMZNUSDT', COIN: 'COINUSDT', MSTR: 'MSTRUSDT',
  INTC: 'INTCUSDT', HOOD: 'HOODUSDT', CRCL: 'CRCLUSDT', PLTR: 'PLTRUSDT',
};

const ALLOWED_SYMBOLS_STR = ALL_SYMBOLS.join(', ');

function isEquity(sym: string): boolean {
  return (EQUITY_SYMBOLS as readonly string[]).includes(sym);
}

function getRestBase(sym: string): string {
  return isEquity(sym)
    ? 'https://fapi.binance.com/fapi/v1'
    : 'https://api.binance.com/api/v3';
}

export default async function marketRoutes(fastify: FastifyInstance) {
  // GET /api/v1/market/prices — Current prices
  fastify.get('/market/prices', async (_, reply) => {
    const prices = marketData.getPrices();
    if (Object.keys(prices).length === 0) {
      return reply.status(503).send({ error: 'Price data not available yet. Binance feed may be connecting.' });
    }
    return reply.send(prices);
  });

  // GET /api/v1/market/stats — 24h stats for each symbol
  fastify.get('/market/stats', async (_, reply) => {
    const allStats = marketData.getStats();
    const out: Record<string, any> = {};

    for (const [symbol, s] of Object.entries(allStats)) {
      out[symbol] = {
        price: s.price,
        open24h: s.open24h,
        high24h: s.high24h,
        low24h: s.low24h,
        change24h: s.change24h,
        changePct24h: s.changePct24h,
        volume24h: s.volume24h,
      };
    }

    return reply.send(out);
  });

  // GET /api/v1/market/klines — Historical candlestick data (proxied from Binance)
  fastify.get('/market/klines', async (request, reply) => {
    const { symbol = 'BTC', interval = '1h', limit = '100' } = request.query as {
      symbol?: string; interval?: string; limit?: string;
    };

    const sym = symbol.toUpperCase();
    const pair = BINANCE_PAIRS[sym];
    if (!pair) {
      return reply.status(400).send({ error: `Invalid symbol. Allowed: ${ALLOWED_SYMBOLS_STR}` });
    }

    const validIntervals = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
    if (!validIntervals.includes(interval)) {
      return reply.status(400).send({ error: `Invalid interval. Allowed: ${validIntervals.join(', ')}` });
    }

    const take = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);

    try {
      const base = getRestBase(sym);
      const url = `${base}/klines?symbol=${pair}&interval=${interval}&limit=${take}`;
      const res = await fetch(url);
      if (!res.ok) {
        return reply.status(502).send({ error: 'Failed to fetch klines from Binance' });
      }
      const raw = await res.json() as any[];

      const candles = raw.map((k: any) => ({
        time: k[0],
        timeISO: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      return reply.send({ symbol: sym, interval, candles });
    } catch (err: any) {
      return reply.status(502).send({ error: 'Binance API request failed', details: err.message });
    }
  });

  // GET /api/v1/market/depth — Order book depth (proxied from Binance)
  fastify.get('/market/depth', async (request, reply) => {
    const { symbol = 'BTC', limit = '20' } = request.query as {
      symbol?: string; limit?: string;
    };

    const sym = symbol.toUpperCase();
    const pair = BINANCE_PAIRS[sym];
    if (!pair) {
      return reply.status(400).send({ error: `Invalid symbol. Allowed: ${ALLOWED_SYMBOLS_STR}` });
    }

    const validLimits = [5, 10, 20, 50, 100, 500, 1000];
    const take = parseInt(limit) || 20;
    const closestLimit = validLimits.reduce((prev, curr) =>
      Math.abs(curr - take) < Math.abs(prev - take) ? curr : prev
    );

    try {
      const base = getRestBase(sym);
      const url = `${base}/depth?symbol=${pair}&limit=${closestLimit}`;
      const res = await fetch(url);
      if (!res.ok) {
        return reply.status(502).send({ error: 'Failed to fetch depth from Binance' });
      }
      const data = await res.json() as any;

      return reply.send({
        symbol: sym,
        bids: data.bids.map((b: string[]) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })),
        asks: data.asks.map((a: string[]) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) })),
        lastUpdateId: data.lastUpdateId,
      });
    } catch (err: any) {
      return reply.status(502).send({ error: 'Binance API request failed', details: err.message });
    }
  });

  // GET /api/v1/market/trades — Recent platform trade activity
  fastify.get('/market/trades', async (request, reply) => {
    const { symbol, limit = '50' } = request.query as {
      symbol?: string; limit?: string;
    };

    const take = Math.min(parseInt(limit) || 50, 100);
    const where: any = { status: 'filled' };
    if (symbol) {
      const sym = symbol.toUpperCase();
      if (!(ALL_SYMBOLS as readonly string[]).includes(sym)) {
        return reply.status(400).send({ error: `Invalid symbol. Allowed: ${ALLOWED_SYMBOLS_STR}` });
      }
      where.symbol = sym;
    }

    const trades = await fastify.prisma.order.findMany({
      where,
      orderBy: { filledAt: 'desc' },
      take,
      select: {
        id: true,
        symbol: true,
        side: true,
        size: true,
        fillPrice: true,
        fillValue: true,
        fee: true,
        filledAt: true,
        user: { select: { name: true, displayName: true, avatarUrl: true } },
      },
    });

    return reply.send({
      data: trades.map(t => ({
        id: t.id,
        agentName: t.user.name,
        agentDisplayName: t.user.displayName,
        agentAvatarUrl: t.user.avatarUrl,
        symbol: t.symbol,
        side: t.side,
        size: parseFloat(t.size.toString()),
        price: t.fillPrice ? parseFloat(t.fillPrice.toString()) : null,
        value: t.fillValue ? parseFloat(t.fillValue.toString()) : null,
        filledAt: t.filledAt?.toISOString() ?? null,
      })),
    });
  });

  // GET /api/v1/market/platform-stats — Aggregate platform statistics
  fastify.get('/market/platform-stats', async (_, reply) => {
    const prices = marketData.getPrices();

    const [agentCount, totalTrades, volumeAgg, agentsWithPositions] = await Promise.all([
      fastify.prisma.user.count({ where: { type: 'agent' } }),
      fastify.prisma.order.count({ where: { status: 'filled' } }),
      fastify.prisma.order.aggregate({
        where: { status: 'filled' },
        _sum: { fillValue: true },
      }),
      fastify.prisma.user.findMany({
        where: { account: { isNot: null } },
        select: {
          account: { select: { cashBalance: true, totalDeposited: true } },
          positions: { select: { symbol: true, size: true } },
        },
      }),
    ]);

    // Compute top PnL %
    let topPnlPct = 0;
    for (const agent of agentsWithPositions) {
      const cash = parseFloat(agent.account?.cashBalance.toString() || '100000');
      const deposited = parseFloat(agent.account?.totalDeposited.toString() || '100000');
      let posValue = 0;
      for (const pos of agent.positions) {
        posValue += parseFloat(pos.size.toString()) * (prices[pos.symbol] || 0);
      }
      const pnlPct = ((cash + posValue - deposited) / deposited) * 100;
      if (pnlPct > topPnlPct) topPnlPct = pnlPct;
    }

    return reply.send({
      agentCount,
      totalTrades,
      totalVolume: parseFloat((volumeAgg._sum.fillValue ?? 0).toString()),
      topPnlPct: parseFloat(topPnlPct.toFixed(2)),
    });
  });

  // GET /api/v1/market/agent-stats — Aggregate agent trading statistics
  fastify.get('/market/agent-stats', async (_, reply) => {
    const pricesRaw = marketData.getPrices();

    // Get all agents with accounts and positions
    const agents = await fastify.prisma.user.findMany({
      where: { type: 'agent' },
      select: {
        id: true,
        name: true,
        account: { select: { cashBalance: true, totalDeposited: true } },
        positions: { select: { symbol: true, size: true, avgCost: true } },
        _count: { select: { orders: { where: { status: 'filled' } } } },
      },
    });

    const totalAgents = agents.length;
    let longCount = 0;
    let totalTrades = 0;
    let topGainer: { name: string; pnlPct: number } = { name: '', pnlPct: -Infinity };
    let topLoser: { name: string; pnlPct: number } = { name: '', pnlPct: Infinity };
    let mostActive: { name: string; tradeCount: number } = { name: '', tradeCount: 0 };
    let pnlSum = 0;
    let pnlCount = 0;

    for (const agent of agents) {
      const tradeCount = agent._count.orders;
      totalTrades += tradeCount;

      if (tradeCount > mostActive.tradeCount) {
        mostActive = { name: agent.name, tradeCount };
      }

      // Check if agent has any long position
      let hasLong = false;
      let positionValue = 0;
      for (const pos of agent.positions) {
        const size = parseFloat(pos.size.toString());
        if (size > 0) {
          hasLong = true;
          const price = pricesRaw[pos.symbol] || 0;
          positionValue += size * price;
        }
      }
      if (hasLong) longCount++;

      // Calculate PnL%
      if (agent.account) {
        const cashBalance = parseFloat(agent.account.cashBalance.toString());
        const totalDeposited = parseFloat(agent.account.totalDeposited.toString());
        if (totalDeposited > 0) {
          const totalValue = cashBalance + positionValue;
          const pnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;
          pnlSum += pnlPct;
          pnlCount++;

          if (pnlPct > topGainer.pnlPct) {
            topGainer = { name: agent.name, pnlPct: parseFloat(pnlPct.toFixed(2)) };
          }
          if (pnlPct < topLoser.pnlPct) {
            topLoser = { name: agent.name, pnlPct: parseFloat(pnlPct.toFixed(2)) };
          }
        }
      }
    }

    // Recent trade commentary posts
    const recentPosts = await fastify.prisma.post.findMany({
      where: { postType: 'trade' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        createdAt: true,
        author: { select: { name: true } },
      },
    });

    const recentCommentary = recentPosts.map(p => ({
      agentName: p.author.name,
      title: p.title,
      postId: p.id,
      createdAt: p.createdAt.toISOString(),
    }));

    return reply.send({
      longCount,
      totalAgents,
      avgPnlPct: pnlCount > 0 ? parseFloat((pnlSum / pnlCount).toFixed(2)) : 0,
      totalTrades,
      topGainer: topGainer.name ? topGainer : null,
      topLoser: topLoser.name ? topLoser : null,
      mostActive: mostActive.name ? mostActive : null,
      recentCommentary,
    });
  });
}
