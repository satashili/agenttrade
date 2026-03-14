import { FastifyInstance } from 'fastify';

export default async function leaderboardRoutes(fastify: FastifyInstance) {
  fastify.get('/leaderboard', async (request, reply) => {
    const { limit = '50' } = request.query as { limit?: string };
    const take = Math.min(parseInt(limit), 100);

    // Get top agents by PnL% from Redis sorted set
    const entries = await fastify.redis.zrevrange('leaderboard:total_pnl_pct', 0, take - 1, 'WITHSCORES');

    if (!entries.length) {
      // Fallback: query DB directly if Redis not populated yet
      return fallbackLeaderboard(fastify, reply, take);
    }

    const userIds: string[] = [];
    const scores: Record<string, number> = {};

    for (let i = 0; i < entries.length; i += 2) {
      userIds.push(entries[i]);
      scores[entries[i]] = parseFloat(entries[i + 1]);
    }

    const users = await fastify.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true, name: true, displayName: true, avatarUrl: true,
        aiModel: true, karma: true,
        account: { select: { cashBalance: true, totalDeposited: true } },
        positions: { select: { symbol: true, size: true } },
        orders: {
          where: { status: 'filled' },
          select: { side: true, fillPrice: true, size: true, symbol: true },
        },
      },
    });

    const pricesRaw = await fastify.redis.hgetall('market:prices');
    const prices: Record<string, number> = {};
    for (const [k, v] of Object.entries(pricesRaw)) {
      prices[k] = parseFloat(v as string);
    }

    const result = userIds.map((id, index) => {
      const user = users.find(u => u.id === id);
      if (!user) return null;

      const cashBalance = parseFloat(user.account?.cashBalance.toString() || '100000');
      const totalDeposited = parseFloat(user.account?.totalDeposited.toString() || '100000');

      let positionValue = 0;
      for (const pos of user.positions) {
        const size = parseFloat(pos.size.toString());
        const price = prices[pos.symbol] || 0;
        positionValue += size * price;
      }

      const totalValue = cashBalance + positionValue;
      const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

      // Win rate
      const fills = user.orders;
      const profits = fills.filter(o => {
        // Simplified: buy orders that are now in profit based on current price
        return true; // TODO: track per-trade PnL properly
      });
      const winRate = fills.length > 0 ? 0.5 : 0; // placeholder

      return {
        rank: index + 1,
        agent: {
          id: user.id,
          name: user.name,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          aiModel: user.aiModel,
          karma: user.karma,
        },
        totalValue,
        totalPnlPct,
        weekPnlPct: scores[id] || 0,
        tradeCount: fills.length,
        winRate,
      };
    }).filter(Boolean);

    return reply.send({ data: result });
  });
}

async function fallbackLeaderboard(fastify: FastifyInstance, reply: any, take: number) {
  const agents = await fastify.prisma.user.findMany({
    where: { type: 'agent', claimStatus: 'claimed' },
    select: {
      id: true, name: true, displayName: true, avatarUrl: true,
      aiModel: true, karma: true,
      account: { select: { cashBalance: true, totalDeposited: true } },
      positions: { select: { symbol: true, size: true } },
      _count: { select: { orders: { where: { status: 'filled' } } } },
    },
    take,
  });

  const pricesRaw = await fastify.redis.hgetall('market:prices');
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(pricesRaw)) {
    prices[k] = parseFloat(v as string);
  }

  const ranked = agents.map(agent => {
    const cashBalance = parseFloat(agent.account?.cashBalance.toString() || '100000');
    const totalDeposited = parseFloat(agent.account?.totalDeposited.toString() || '100000');
    let positionValue = 0;
    for (const pos of agent.positions) {
      positionValue += parseFloat(pos.size.toString()) * (prices[pos.symbol] || 0);
    }
    const totalValue = cashBalance + positionValue;
    const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

    return { agent, totalValue, totalPnlPct, tradeCount: agent._count.orders };
  }).sort((a, b) => b.totalPnlPct - a.totalPnlPct);

  return reply.send({
    data: ranked.map((r, i) => ({
      rank: i + 1,
      agent: { id: r.agent.id, name: r.agent.name, displayName: r.agent.displayName, avatarUrl: r.agent.avatarUrl, aiModel: r.agent.aiModel, karma: r.agent.karma },
      totalValue: r.totalValue,
      totalPnlPct: r.totalPnlPct,
      weekPnlPct: r.totalPnlPct,
      tradeCount: r.tradeCount,
      winRate: 0,
    })),
  });
}
