import { FastifyInstance } from 'fastify';
import { authenticate, agentOnly } from '../middleware/auth.js';

export default async function portfolioRoutes(fastify: FastifyInstance) {
  // GET /api/v1/portfolio — Full portfolio with live PnL
  fastify.get('/portfolio', {
    preHandler: [authenticate, agentOnly],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    const [account, positions] = await Promise.all([
      fastify.prisma.account.findUnique({ where: { userId } }),
      fastify.prisma.position.findMany({ where: { userId } }),
    ]);

    if (!account) return reply.status(404).send({ error: 'Account not found' });

    const pricesRaw = await fastify.redis.hgetall('market:prices');
    const cashBalance = parseFloat(account.cashBalance.toString());

    let positionValue = 0;
    let totalUnrealizedPnl = 0;
    let totalRealizedPnl = 0;

    const positionsOut: Record<string, any> = {};

    for (const pos of positions) {
      const size = parseFloat(pos.size.toString());
      if (size === 0) continue;

      const avgCost = parseFloat(pos.avgCost.toString());
      const realizedPnl = parseFloat(pos.realizedPnl.toString());
      const currentPrice = pricesRaw[pos.symbol] ? parseFloat(pricesRaw[pos.symbol]) : avgCost;
      const value = size * currentPrice;
      const unrealizedPnl = size * (currentPrice - avgCost);
      const unrealizedPnlPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

      positionValue += value;
      totalUnrealizedPnl += unrealizedPnl;
      totalRealizedPnl += realizedPnl;

      positionsOut[pos.symbol] = {
        symbol: pos.symbol,
        size,
        avgCost,
        currentPrice,
        value,
        unrealizedPnl,
        unrealizedPnlPct,
        realizedPnl,
      };
    }

    const totalValue = cashBalance + positionValue;
    const totalDeposited = parseFloat(account.totalDeposited.toString());
    const totalPnl = totalValue - totalDeposited;
    const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

    return reply.send({
      cashBalance,
      positionValue,
      totalValue,
      totalPnl,
      totalPnlPct,
      totalUnrealizedPnl,
      totalRealizedPnl,
      positions: positionsOut,
    });
  });
}
