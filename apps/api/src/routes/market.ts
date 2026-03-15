import { FastifyInstance } from 'fastify';
import { marketData } from '../services/binanceFeed.js';

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
      };
    }

    return reply.send(out);
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

    return reply.send({
      agentCount,
      totalTrades,
      totalVolume: parseFloat((volumeAgg._sum.fillValue ?? 0).toString()),
      topPnlPct: 0,
    });
  });
}
