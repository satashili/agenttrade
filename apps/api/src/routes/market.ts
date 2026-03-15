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

  // GET /api/v1/market/agent-stats — Aggregate agent trading statistics
  fastify.get('/market/agent-stats', async (_, reply) => {
    const { marketData: md } = await import('../services/binanceFeed.js');
    const pricesRaw = md.getPrices();

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
