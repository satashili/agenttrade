import { FastifyInstance } from 'fastify';

const SYMBOLS = ['BTC', 'ETH', 'SOL'];

export default async function marketRoutes(fastify: FastifyInstance) {
  // GET /api/v1/market/prices — Current prices
  fastify.get('/market/prices', async (_, reply) => {
    const raw = await fastify.redis.hgetall('market:prices');
    if (!raw || Object.keys(raw).length === 0) {
      return reply.status(503).send({ error: 'Price data not available yet. Hyperliquid feed may be connecting.' });
    }

    const prices: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      prices[k] = parseFloat(v as string);
    }
    return reply.send(prices);
  });

  // GET /api/v1/market/stats — 24h stats for each symbol
  fastify.get('/market/stats', async (_, reply) => {
    const stats: Record<string, any> = {};

    for (const symbol of SYMBOLS) {
      const raw = await fastify.redis.hgetall(`market:stats:${symbol}`);
      if (raw) {
        stats[symbol] = {
          price: parseFloat(raw.price || '0'),
          open24h: parseFloat(raw.open24h || '0'),
          high24h: parseFloat(raw.high24h || '0'),
          low24h: parseFloat(raw.low24h || '0'),
          change24h: parseFloat(raw.change24h || '0'),
          changePct24h: parseFloat(raw.changePct24h || '0'),
        };
      }
    }

    return reply.send(stats);
  });

  // GET /api/v1/market/candles?symbol=BTC&interval=1h&limit=200 — OHLCV candle data
  fastify.get('/market/candles', async (request, reply) => {
    const { symbol = 'BTC', interval = '1h', limit = '200' } = request.query as Record<string, string>;

    if (!SYMBOLS.includes(symbol.toUpperCase())) {
      return reply.status(400).send({ error: `Invalid symbol. Supported: ${SYMBOLS.join(', ')}` });
    }

    // Pull from Redis cache (populated by Hyperliquid service)
    const cacheKey = `candles:${symbol}:${interval}`;
    const cached = await fastify.redis.get(cacheKey);
    if (cached) {
      const candles = JSON.parse(cached);
      return reply.send(candles.slice(-parseInt(limit)));
    }

    return reply.status(503).send({ error: 'Candle data not available yet' });
  });

  // GET /api/v1/market/platform-stats — Aggregate platform statistics
  fastify.get('/market/platform-stats', async (_, reply) => {
    const [agentCount, totalTrades, volumeAgg] = await Promise.all([
      fastify.prisma.user.count({ where: { type: 'agent' } }),
      fastify.prisma.order.count({ where: { status: 'filled' } }),
      fastify.prisma.order.aggregate({
        where: { status: 'filled' },
        _sum: { fillValue: true },
      }),
    ]);

    let topPnlPct = 0;
    try {
      const top = await fastify.redis.zrevrange('leaderboard:pnlPct', 0, 0, 'WITHSCORES');
      if (top && top.length >= 2) {
        topPnlPct = parseFloat(top[1]);
      }
    } catch {
      // Redis key may not exist yet
    }

    return reply.send({
      agentCount,
      totalTrades,
      totalVolume: parseFloat((volumeAgg._sum.fillValue ?? 0).toString()),
      topPnlPct,
    });
  });
}
