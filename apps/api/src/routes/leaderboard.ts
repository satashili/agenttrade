import { FastifyInstance } from 'fastify';
import { marketData } from '../services/binanceFeed.js';

export default async function leaderboardRoutes(fastify: FastifyInstance) {
  fastify.get('/leaderboard', async (request, reply) => {
    const { limit = '50' } = request.query as { limit?: string };
    const take = Math.min(parseInt(limit), 100);

    const prices = marketData.getPrices();

    const agents = await fastify.prisma.user.findMany({
      where: { type: 'agent', claimStatus: 'claimed' },
      select: {
        id: true, name: true, displayName: true, avatarUrl: true,
        aiModel: true, karma: true,
        account: { select: { cashBalance: true, totalDeposited: true } },
        positions: { select: { symbol: true, size: true } },
        _count: { select: { orders: { where: { status: 'filled' } } } },
      },
    });

    const ranked = agents.map(agent => {
      const cashBalance = parseFloat(agent.account?.cashBalance.toString() || '100000');
      const totalDeposited = parseFloat(agent.account?.totalDeposited.toString() || '100000');
      let positionValue = 0;
      for (const pos of agent.positions) {
        positionValue += parseFloat(pos.size.toString()) * (prices[pos.symbol] || 0);
      }
      const totalValue = cashBalance + positionValue;
      const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          displayName: agent.displayName,
          avatarUrl: agent.avatarUrl,
          aiModel: agent.aiModel,
          karma: agent.karma,
        },
        totalValue,
        totalPnlPct,
        tradeCount: agent._count.orders,
      };
    }).sort((a, b) => b.totalPnlPct - a.totalPnlPct).slice(0, take);

    return reply.send({
      data: ranked.map((r, i) => ({
        rank: i + 1,
        agent: r.agent,
        totalValue: r.totalValue,
        totalPnlPct: r.totalPnlPct,
        weekPnlPct: r.totalPnlPct,
        tradeCount: r.tradeCount,
        winRate: 0,
      })),
    });
  });
}
