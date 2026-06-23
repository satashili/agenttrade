import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getOrCreateMatchxUserId } from '../services/matchxAccount.js';
import { getMatchxClient } from '../services/matchxClient.js';
import { syncMatchxAccountState } from '../services/matchxTrading.js';

export default async function copyTradingRoutes(fastify: FastifyInstance) {

  // POST /api/v1/copy-trading/apply — Apply to become a lead trader (PnL > 5%)
  fastify.post('/copy-trading/apply', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { isLeadTrader: true, name: true },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (user.isLeadTrader) return reply.status(409).send({ error: 'Already a lead trader' });

    const matchxUserId = await getOrCreateMatchxUserId(fastify.prisma, userId);
    const account = await getMatchxClient().getAccount(matchxUserId);
    syncMatchxAccountState(fastify.prisma, userId, matchxUserId).catch(() => {});

    const totalValue = account.totalEquity || account.walletBalance || 0;
    const totalDeposited = account.initialBalance || 100000;
    const pnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

    if (pnlPct < 5) {
      return reply.status(422).send({
        error: `PnL must be > 5% to become a lead trader. Current: ${pnlPct.toFixed(2)}%`,
        currentPnlPct: pnlPct,
        required: 5,
      });
    }

    await fastify.prisma.user.update({
      where: { id: userId },
      data: { isLeadTrader: true },
    });

    return reply.send({
      message: `${user.name} is now a lead trader! Other agents can copy your trades.`,
      pnlPct: parseFloat(pnlPct.toFixed(2)),
    });
  });

  // GET /api/v1/copy-trading/leaders — List all lead traders with stats
  fastify.get('/copy-trading/leaders', async (_, reply) => {
    const leaders = await fastify.prisma.user.findMany({
      where: { isLeadTrader: true },
      select: {
        id: true, name: true, displayName: true, avatarUrl: true, type: true,
        aiModel: true, karma: true,
        matchxAccount: { select: { matchxUserId: true } },
        account: { select: { cashBalance: true, totalDeposited: true } },
        _count: {
          select: {
            orders: { where: { status: 'filled' } },
            copyLeading: { where: { active: true } },
          },
        },
      },
    });

    const client = getMatchxClient();
    const data = (await Promise.all(leaders.map(async leader => {
      const cashBalance = parseFloat(leader.account?.cashBalance.toString() || '100000');
      const totalDeposited = parseFloat(leader.account?.totalDeposited.toString() || '100000');
      let totalValue = cashBalance;
      let deposited = totalDeposited;
      if (leader.matchxAccount) {
        try {
          const account = await client.getAccount(Number(leader.matchxAccount.matchxUserId));
          totalValue = account.totalEquity || account.walletBalance || cashBalance;
          deposited = account.initialBalance || totalDeposited;
        } catch {
          totalValue = cashBalance;
        }
      }
      const pnlPct = ((totalValue - deposited) / deposited) * 100;

      return {
        id: leader.id,
        name: leader.name,
        displayName: leader.displayName,
        avatarUrl: leader.avatarUrl,
        type: leader.type,
        aiModel: leader.aiModel,
        karma: leader.karma,
        totalValue,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        tradeCount: leader._count.orders,
        copierCount: leader._count.copyLeading,
      };
    }))).sort((a, b) => b.pnlPct - a.pnlPct);

    return reply.send({ data });
  });

  // POST /api/v1/copy-trading/follow/:name — Start copying a leader
  fastify.post('/copy-trading/follow/:name', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const followerId = request.authUser!.id;

    const leader = await fastify.prisma.user.findUnique({
      where: { name },
      select: { id: true, name: true, isLeadTrader: true },
    });

    if (!leader) return reply.status(404).send({ error: 'User not found' });
    if (!leader.isLeadTrader) return reply.status(422).send({ error: `${leader.name} is not a lead trader` });
    if (leader.id === followerId) return reply.status(400).send({ error: 'Cannot copy yourself' });

    await fastify.prisma.copyFollow.upsert({
      where: { leaderId_followerId: { leaderId: leader.id, followerId } },
      update: { active: true },
      create: { leaderId: leader.id, followerId },
    });

    const copierCount = await fastify.prisma.copyFollow.count({
      where: { leaderId: leader.id, active: true },
    });

    // Notify leader
    await fastify.prisma.notification.create({
      data: {
        userId: leader.id,
        type: 'copy_follow',
        actorId: followerId,
        message: `${request.authUser!.name} started copying your trades`,
      },
    });

    return reply.send({
      message: `Now copying ${leader.name}'s trades`,
      copierCount,
    });
  });

  // DELETE /api/v1/copy-trading/follow/:name — Stop copying
  fastify.delete('/copy-trading/follow/:name', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const followerId = request.authUser!.id;

    const leader = await fastify.prisma.user.findUnique({
      where: { name },
      select: { id: true },
    });
    if (!leader) return reply.status(404).send({ error: 'User not found' });

    await fastify.prisma.copyFollow.updateMany({
      where: { leaderId: leader.id, followerId, active: true },
      data: { active: false },
    });

    return reply.send({ message: `Stopped copying ${name}` });
  });

  // GET /api/v1/copy-trading/my-copiers — Who's copying me
  fastify.get('/copy-trading/my-copiers', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    const copiers = await fastify.prisma.copyFollow.findMany({
      where: { leaderId: userId, active: true },
      select: {
        follower: {
          select: { id: true, name: true, displayName: true, type: true, aiModel: true },
        },
        createdAt: true,
      },
    });

    return reply.send({
      copierCount: copiers.length,
      copiers: copiers.map(c => ({
        ...c.follower,
        since: c.createdAt.toISOString(),
      })),
    });
  });

  // GET /api/v1/copy-trading/my-leaders — Who am I copying
  fastify.get('/copy-trading/my-leaders', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    const leaders = await fastify.prisma.copyFollow.findMany({
      where: { followerId: userId, active: true },
      select: {
        leader: {
          select: { id: true, name: true, displayName: true, type: true, aiModel: true, isLeadTrader: true },
        },
        createdAt: true,
      },
    });

    return reply.send({
      data: leaders.map(l => ({
        ...l.leader,
        since: l.createdAt.toISOString(),
      })),
    });
  });
}
