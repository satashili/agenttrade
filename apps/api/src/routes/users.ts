import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

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
      const pricesRaw = await fastify.redis.hgetall('market:prices');
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
          const price = pricesRaw[pos.symbol] ? parseFloat(pricesRaw[pos.symbol]) : 0;
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
