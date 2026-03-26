import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { marketData } from '../services/binanceFeed.js';

export default async function userRoutes(fastify: FastifyInstance) {
  // GET /api/v1/users/:name — Public profile
  fastify.get('/users/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    const user = await fastify.prisma.user.findUnique({
      where: { name: name.toLowerCase() },
      select: {
        id: true, type: true, name: true, displayName: true,
        description: true, avatarUrl: true, aiModel: true,
        karma: true, claimStatus: true, createdAt: true,
        _count: {
          select: {
            followers: true,
            following: true,
            posts: true,
            orders: { where: { status: 'filled' } },
          },
        },
      },
    });

    if (!user) return reply.status(404).send({ error: 'User not found' });

    // Attach portfolio if agent
    let portfolio = null;
    if (user.type === 'agent') {
      const pricesRaw = marketData.getPrices();
      const account = await fastify.prisma.account.findUnique({ where: { userId: user.id } });
      const positions = await fastify.prisma.position.findMany({ where: { userId: user.id } });

      if (account) {
        const cashBalance = parseFloat(account.cashBalance.toString());
        const totalDeposited = parseFloat(account.totalDeposited.toString());
        let positionValue = 0;

        const posOut: Record<string, any> = {};
        for (const pos of positions) {
          const size = parseFloat(pos.size.toString());
          if (size === 0) continue;
          const price = pricesRaw[pos.symbol] || 0;
          const value = size * price;
          positionValue += value;
          posOut[pos.symbol] = {
            size,
            avgCost: parseFloat(pos.avgCost.toString()),
            currentPrice: price,
            value,
            unrealizedPnl: value - size * parseFloat(pos.avgCost.toString()),
          };
        }

        const totalValue = cashBalance + positionValue;
        portfolio = {
          cashBalance,
          totalValue,
          totalPnlPct: ((totalValue - totalDeposited) / totalDeposited) * 100,
          positions: posOut,
        };
      }
    }

    return reply.send({ user, portfolio });
  });

  // PATCH /api/v1/users/me — Update own profile
  fastify.patch('/users/me', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { displayName, description, avatarUrl } = request.body as any;

    const updated = await fastify.prisma.user.update({
      where: { id: request.authUser!.id },
      data: {
        ...(displayName && { displayName }),
        ...(description !== undefined && { description }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
      select: { id: true, name: true, displayName: true, description: true, avatarUrl: true },
    });

    return reply.send({ user: updated });
  });

  // POST /api/v1/users/:name/follow
  fastify.post('/users/:name/follow', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const followerId = request.authUser!.id;

    const target = await fastify.prisma.user.findUnique({ where: { name: name.toLowerCase() } });
    if (!target) return reply.status(404).send({ error: 'User not found' });
    if (target.id === followerId) return reply.status(400).send({ error: 'Cannot follow yourself' });

    await fastify.prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId: target.id } },
      update: {},
      create: { followerId, followingId: target.id },
    });

    await fastify.prisma.notification.create({
      data: {
        userId: target.id,
        type: 'follow',
        actorId: followerId,
        message: `${request.authUser!.name} started following you`,
      },
    });

    await fastify.prisma.user.update({
      where: { id: target.id },
      data: { karma: { increment: 2 } },
    });

    return reply.send({ message: `Following ${target.name}` });
  });

  // GET /api/v1/users/compare?a={name1}&b={name2}
  fastify.get('/users/compare', async (request, reply) => {
    const { a, b } = request.query as { a?: string; b?: string };
    if (!a || !b) return reply.status(400).send({ error: 'Both query params a and b are required' });

    const pricesRaw = marketData.getPrices();

    async function getAgentData(name: string) {
      const user = await fastify.prisma.user.findUnique({
        where: { name: name.toLowerCase() },
        select: {
          id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true,
          _count: { select: { orders: { where: { status: 'filled' } } } },
        },
      });
      if (!user) return null;

      const account = await fastify.prisma.account.findUnique({ where: { userId: user.id } });
      const positions = await fastify.prisma.position.findMany({ where: { userId: user.id } });

      let positionValue = 0;
      const posOut: Record<string, any> = {};
      for (const pos of positions) {
        const size = parseFloat(pos.size.toString());
        if (size === 0) continue;
        const price = pricesRaw[pos.symbol] || 0;
        const value = size * price;
        positionValue += value;
        posOut[pos.symbol] = {
          size,
          avgCost: parseFloat(pos.avgCost.toString()),
          currentPrice: price,
          value,
          unrealizedPnl: value - size * parseFloat(pos.avgCost.toString()),
        };
      }

      const cashBalance = account ? parseFloat(account.cashBalance.toString()) : 0;
      const totalDeposited = account ? parseFloat(account.totalDeposited.toString()) : 0;
      const totalValue = cashBalance + positionValue;
      const totalPnlPct = totalDeposited > 0 ? ((totalValue - totalDeposited) / totalDeposited) * 100 : 0;

      // Win rate: orders where sell price > avgCost at time (approximate with profitable sells)
      const wins = await fastify.prisma.order.count({
        where: { userId: user.id, status: 'filled', side: 'sell' },
      });
      const totalFilled = user._count.orders;
      const winRate = totalFilled > 0 ? parseFloat(((wins / totalFilled) * 100).toFixed(1)) : 0;

      return {
        name: user.name,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        type: user.type,
        karma: user.karma,
        portfolioValue: parseFloat(totalValue.toFixed(2)),
        pnlPct: parseFloat(totalPnlPct.toFixed(2)),
        tradeCount: totalFilled,
        winRate,
        positions: posOut,
      };
    }

    const [agentA, agentB] = await Promise.all([getAgentData(a), getAgentData(b)]);

    if (!agentA) return reply.status(404).send({ error: `User '${a}' not found` });
    if (!agentB) return reply.status(404).send({ error: `User '${b}' not found` });

    return reply.send({ a: agentA, b: agentB });
  });

  // GET /api/v1/users/:name/trades — Public full order history with FIFO PnL
  fastify.get('/users/:name/trades', async (request, reply) => {
    const { name } = request.params as { name: string };
    const { limit = '20', cursor } = request.query as Record<string, string>;

    const user = await fastify.prisma.user.findUnique({
      where: { name: name.toLowerCase() },
      select: { id: true },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const orders = await fastify.prisma.order.findMany({
      where: { userId: user.id, status: 'filled' },
      orderBy: { filledAt: 'asc' },
      select: {
        symbol: true, side: true, size: true,
        fillPrice: true, fee: true, filledAt: true, strategyId: true,
      },
    });

    interface PosState { size: number; avgCost: number; }
    const positions: Record<string, PosState> = {};

    interface TradeRecord {
      symbol: string;
      side: string;
      action: 'open' | 'close' | 'add' | 'reduce' | 'flip';
      size: number;
      price: number;
      fee: number;
      realizedPnl: number | null;
      positionAfter: number;
      reason: string;
      filledAt: string;
    }
    const trades: TradeRecord[] = [];

    for (const o of orders) {
      const sz = parseFloat(o.size.toString());
      const price = parseFloat(o.fillPrice!.toString());
      const fee = parseFloat(o.fee!.toString());
      const filledAt = o.filledAt!;

      if (!positions[o.symbol]) positions[o.symbol] = { size: 0, avgCost: 0 };
      const pos = positions[o.symbol];
      const oldSize = pos.size;
      const sizeChange = o.side === 'buy' ? sz : -sz;
      const newSize = oldSize + sizeChange;

      // Determine closing portion and realized PnL
      let closingSize = 0;
      if (o.side === 'sell' && oldSize > 0) closingSize = Math.min(sz, oldSize);
      else if (o.side === 'buy' && oldSize < 0) closingSize = Math.min(sz, Math.abs(oldSize));

      let realizedPnl: number | null = null;
      if (closingSize > 0) {
        const dir = oldSize > 0 ? 'long' : 'short';
        realizedPnl = dir === 'long'
          ? closingSize * (price - pos.avgCost)
          : closingSize * (pos.avgCost - price);
        realizedPnl = parseFloat(realizedPnl.toFixed(8));
      }

      // Classify action
      let action: TradeRecord['action'];
      if (oldSize === 0) {
        action = 'open';
      } else if (newSize === 0) {
        action = 'close';
      } else if (Math.sign(newSize) !== Math.sign(oldSize)) {
        action = 'flip';
      } else if (Math.abs(newSize) > Math.abs(oldSize)) {
        action = 'add';
      } else {
        action = 'reduce';
      }

      trades.push({
        symbol: o.symbol,
        side: o.side as string,
        action,
        size: parseFloat(sz.toFixed(8)),
        price,
        fee: parseFloat(fee.toFixed(8)),
        realizedPnl,
        positionAfter: parseFloat(newSize.toFixed(8)),
        reason: o.strategyId ? 'strategy' : 'manual',
        filledAt: filledAt.toISOString(),
      });

      // Update position state
      if (newSize === 0) {
        pos.size = 0; pos.avgCost = 0;
      } else if (oldSize !== 0 && Math.sign(newSize) !== Math.sign(oldSize)) {
        pos.size = newSize; pos.avgCost = price;
      } else if (oldSize === 0) {
        pos.size = newSize; pos.avgCost = price;
      } else if (Math.abs(newSize) > Math.abs(oldSize)) {
        const added = Math.abs(newSize) - Math.abs(oldSize);
        pos.avgCost = (Math.abs(oldSize) * pos.avgCost + added * price) / Math.abs(newSize);
        pos.size = newSize;
      } else {
        pos.size = newSize;
      }
    }

    // Newest first
    trades.reverse();

    const slice = cursor ? trades.filter(t => t.filledAt < cursor) : trades;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const hasMore = slice.length > limitNum;
    const data = hasMore ? slice.slice(0, limitNum) : slice;

    return reply.send({
      data,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1].filledAt : null,
    });
  });

  // DELETE /api/v1/users/:name/follow
  fastify.delete('/users/:name/follow', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const followerId = request.authUser!.id;

    const target = await fastify.prisma.user.findUnique({ where: { name: name.toLowerCase() } });
    if (!target) return reply.status(404).send({ error: 'User not found' });

    await fastify.prisma.follow.deleteMany({
      where: { followerId, followingId: target.id },
    });

    return reply.send({ message: `Unfollowed ${target.name}` });
  });
}
