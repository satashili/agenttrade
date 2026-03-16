import { FastifyInstance } from 'fastify';
import { authenticate, agentOnly } from '../middleware/auth.js';
import { marketData } from '../services/binanceFeed.js';

export default async function portfolioRoutes(fastify: FastifyInstance) {
  // Helper: resolve the agent ID for portfolio queries
  async function resolveAgentId(request: any, reply: any): Promise<string | null> {
    if (request.authUser!.type === 'agent') return request.authUser!.id;
    // Human: use first owned agent
    const { agentId } = request.query as { agentId?: string };
    const where: any = { ownerId: request.authUser!.id, type: 'agent' as const };
    if (agentId) where.id = agentId;
    const agent = await fastify.prisma.user.findFirst({ where, select: { id: true } });
    if (!agent) { reply.status(404).send({ error: 'No owned agent found' }); return null; }
    return agent.id;
  }

  // GET /api/v1/portfolio — Full portfolio with live PnL
  fastify.get('/portfolio', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = await resolveAgentId(request, reply);
    if (!userId) return;

    const [account, positions] = await Promise.all([
      fastify.prisma.account.findUnique({ where: { userId } }),
      fastify.prisma.position.findMany({ where: { userId } }),
    ]);

    if (!account) return reply.status(404).send({ error: 'Account not found' });

    const prices = marketData.getPrices();
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
      const currentPrice = prices[pos.symbol] || avgCost;
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

  // GET /api/v1/portfolio/history — Historical PnL curve
  fastify.get('/portfolio/history', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = await resolveAgentId(request, reply);
    if (!userId) return;

    const account = await fastify.prisma.account.findUnique({ where: { userId } });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    const totalDeposited = parseFloat(account.totalDeposited.toString());

    // Get all filled orders chronologically
    const orders = await fastify.prisma.order.findMany({
      where: { userId, status: 'filled' },
      orderBy: { filledAt: 'asc' },
      select: {
        symbol: true, side: true, size: true,
        fillPrice: true, fillValue: true, fee: true, filledAt: true,
      },
    });

    if (orders.length === 0) {
      return reply.send({
        data: [{
          timestamp: account.updatedAt.toISOString(),
          totalValue: totalDeposited,
          cashBalance: totalDeposited,
          positionValue: 0,
          pnl: 0,
          pnlPct: 0,
        }],
      });
    }

    // Replay order history to build equity curve
    let cash = totalDeposited;
    const positions: Record<string, { size: number; avgCost: number }> = {};
    const curve: Array<{
      timestamp: string;
      totalValue: number;
      cashBalance: number;
      positionValue: number;
      pnl: number;
      pnlPct: number;
    }> = [];

    for (const o of orders) {
      const size = parseFloat(o.size.toString());
      const price = parseFloat(o.fillPrice!.toString());
      const value = parseFloat(o.fillValue!.toString());
      const fee = parseFloat(o.fee!.toString());

      if (!positions[o.symbol]) positions[o.symbol] = { size: 0, avgCost: 0 };
      const pos = positions[o.symbol];

      if (o.side === 'buy') {
        cash -= (value + fee);
        const newSize = pos.size + size;
        pos.avgCost = pos.size === 0 ? price : (pos.size * pos.avgCost + size * price) / newSize;
        pos.size = newSize;
      } else {
        cash += (value - fee);
        pos.size = Math.max(0, pos.size - size);
        if (pos.size === 0) pos.avgCost = 0;
      }

      // Compute position value — use fillPrice for traded symbol as market price at that time
      let positionValue = 0;
      for (const [sym, p] of Object.entries(positions)) {
        const priceAtTime = sym === o.symbol ? price : p.avgCost;
        positionValue += p.size * priceAtTime;
      }

      const totalValue = cash + positionValue;
      const pnl = totalValue - totalDeposited;
      const pnlPct = (pnl / totalDeposited) * 100;

      curve.push({
        timestamp: o.filledAt!.toISOString(),
        totalValue: parseFloat(totalValue.toFixed(2)),
        cashBalance: parseFloat(cash.toFixed(2)),
        positionValue: parseFloat(positionValue.toFixed(2)),
        pnl: parseFloat(pnl.toFixed(2)),
        pnlPct: parseFloat(pnlPct.toFixed(4)),
      });
    }

    return reply.send({ data: curve });
  });
}
