import { FastifyInstance } from 'fastify';
import { marketData } from '../services/binanceFeed.js';
import { ALL_SYMBOLS } from '@agenttrade/types';

// In-memory previous rankings for rank change tracking
let previousRanks: Map<string, number> = new Map();

// Cache leaderboard results for 10 seconds to reduce DB load
let cachedResult: { data: any[]; ts: number } | null = null;
const CACHE_TTL_MS = 10_000;

export default async function leaderboardRoutes(fastify: FastifyInstance) {
  fastify.get('/leaderboard', async (request, reply) => {
    const { limit = '50' } = request.query as { limit?: string };
    const take = Math.min(parseInt(limit), 100);

    // Return cached result if fresh enough
    if (cachedResult && Date.now() - cachedResult.ts < CACHE_TTL_MS) {
      return reply.send({ data: cachedResult.data.slice(0, take) });
    }

    const prices = marketData.getPrices();

    const agents = await fastify.prisma.user.findMany({
      where: { account: { isNot: null } }, // all users with accounts (agents + humans)
      select: {
        id: true, type: true, name: true, displayName: true, avatarUrl: true,
        aiModel: true, karma: true,
        account: { select: { cashBalance: true, totalDeposited: true } },
        positions: { select: { symbol: true, size: true, avgCost: true } },
        _count: { select: { orders: { where: { status: 'filled' } } } },
      },
    });

    // Batch-fetch all filled orders to compute winRate
    const agentIds = agents.map(a => a.id);
    const allOrders = agentIds.length > 0
      ? await fastify.prisma.order.findMany({
          where: { userId: { in: agentIds }, status: 'filled' },
          orderBy: { filledAt: 'asc' },
          select: { userId: true, symbol: true, side: true, size: true, fillPrice: true },
        })
      : [];

    // Group orders by userId
    const ordersByAgent = new Map<string, typeof allOrders>();
    for (const o of allOrders) {
      if (!ordersByAgent.has(o.userId)) ordersByAgent.set(o.userId, []);
      ordersByAgent.get(o.userId)!.push(o);
    }

    // Compute winRate by replaying order history per agent
    function computeWinRate(orders: typeof allOrders): number {
      const positions: Record<string, { size: number; avgCost: number }> = {};
      let wins = 0;
      let losses = 0;

      for (const o of orders) {
        const size = parseFloat(o.size.toString());
        const price = parseFloat(o.fillPrice?.toString() || '0');
        if (!positions[o.symbol]) positions[o.symbol] = { size: 0, avgCost: 0 };
        const pos = positions[o.symbol];

        if (o.side === 'buy') {
          if (pos.size < 0) {
            // Closing short — check if profitable
            const closingSize = Math.min(size, Math.abs(pos.size));
            if (pos.avgCost > price) wins++;
            else if (closingSize > 0) losses++;
          }
          const newSize = pos.size + size;
          if (pos.size >= 0) {
            pos.avgCost = pos.size === 0 ? price : (pos.size * pos.avgCost + size * price) / newSize;
          } else if (newSize > 0) {
            pos.avgCost = price; // flipped to long
          }
          pos.size = newSize;
        } else {
          if (pos.size > 0) {
            // Closing long — check if profitable
            if (price > pos.avgCost) wins++;
            else losses++;
          }
          const newSize = pos.size - size;
          if (pos.size <= 0) {
            const absOld = Math.abs(pos.size);
            const absNew = Math.abs(newSize);
            pos.avgCost = absOld === 0 ? price : (absOld * pos.avgCost + size * price) / absNew;
          } else if (newSize < 0) {
            pos.avgCost = price; // flipped to short
          }
          pos.size = newSize;
        }
        if (pos.size === 0) pos.avgCost = 0;
      }

      const total = wins + losses;
      return total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
    }

    const ranked = agents.map(agent => {
      const cashBalance = parseFloat(agent.account?.cashBalance.toString() || '100000');
      const totalDeposited = parseFloat(agent.account?.totalDeposited.toString() || '100000');
      let positionValue = 0;
      let hasShort = false;
      for (const pos of agent.positions) {
        const size = parseFloat(pos.size.toString());
        const price = prices[pos.symbol] || parseFloat(pos.avgCost.toString());
        positionValue += size * price;
        if (size < 0) hasShort = true;
      }
      const totalValue = cashBalance + positionValue;
      const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

      const agentOrders = ordersByAgent.get(agent.id) || [];
      const winRate = computeWinRate(agentOrders);

      return {
        agent: {
          id: agent.id,
          type: agent.type,
          name: agent.name,
          displayName: agent.displayName,
          avatarUrl: agent.avatarUrl,
          aiModel: agent.aiModel,
          karma: agent.karma,
        },
        totalValue,
        totalPnlPct,
        tradeCount: agent._count.orders,
        winRate,
        hasShort,
      };
    }).sort((a, b) => b.totalPnlPct - a.totalPnlPct).slice(0, take);

    // Calculate rank changes
    const result = ranked.map((r, i) => {
      const currentRank = i + 1;
      const prevRank = previousRanks.get(r.agent.id);
      const rankChange = prevRank !== undefined ? prevRank - currentRank : 0; // positive = moved up

      return {
        rank: currentRank,
        rankChange,
        agent: r.agent,
        totalValue: r.totalValue,
        totalPnlPct: r.totalPnlPct,
        weekPnlPct: r.totalPnlPct,
        tradeCount: r.tradeCount,
        winRate: r.winRate,
        hasShort: r.hasShort,
      };
    });

    // Save current rankings for next comparison
    const newRanks = new Map<string, number>();
    for (const r of result) {
      newRanks.set(r.agent.id, r.rank);
    }
    previousRanks = newRanks;

    // Only cache when prices are complete (avoid caching degraded data)
    const pricesComplete = ALL_SYMBOLS.every(s => s in prices);
    if (pricesComplete) {
      cachedResult = { data: result, ts: Date.now() };
    }

    return reply.send({ data: result });
  });
}
