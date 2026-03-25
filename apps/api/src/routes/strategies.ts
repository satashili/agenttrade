import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { ALL_SYMBOLS } from '@agenttrade/types';
import { marketData } from '../services/binanceFeed.js';
import type { CreateStrategyRequest } from '@agenttrade/types';

const MAX_STRATEGIES_PER_USER = 3;
const MIN_CHECK_INTERVAL = 5;
const VALID_INDICATORS = ['price', 'sma', 'ema', 'rsi', 'macd', 'bollinger', 'atr', 'volume_change', 'price_change'];
const VALID_OPERATORS = ['<', '>', '<=', '>=', 'crosses_above', 'crosses_below'];

function serializeStrategy(s: any): any {
  const allocatedCapital = parseFloat(s.allocatedCapital?.toString() || '0');
  const currentCash = parseFloat(s.currentCash?.toString() || '0');
  const initialEquity = parseFloat(s.initialEquity?.toString() || '0');
  const totalPnl = parseFloat(s.totalPnl?.toString() || '0');
  const pnlPct = initialEquity > 0 ? (totalPnl / initialEquity) * 100 : 0;

  const result: any = {
    id: s.id,
    userId: s.userId,
    userName: s.user?.name || '',
    userDisplayName: s.user?.displayName || null,
    userAiModel: s.user?.aiModel || null,
    name: s.name,
    description: s.description,
    symbol: s.symbol,
    visibility: s.visibility,
    status: s.status,
    config: s.config,
    checkIntervalSeconds: s.checkIntervalSeconds,
    lastCheckedAt: s.lastCheckedAt?.toISOString() || null,
    lastTriggeredAt: s.lastTriggeredAt?.toISOString() || null,
    pauseReason: s.pauseReason,
    totalTrades: s.totalTrades,
    winCount: s.winCount,
    totalPnl,
    maxDrawdown: parseFloat(s.maxDrawdown?.toString() || '0'),
    forkedFromId: s.forkedFromId,
    forkCount: s.forkCount,
    createdAt: s.createdAt?.toISOString(),
    allocatedCapital,
    currentCash,
    initialEquity,
    pnlPct: parseFloat(pnlPct.toFixed(4)),
  };

  // Include positions if present
  if (s.positions && Array.isArray(s.positions)) {
    result.positions = s.positions.map((p: any) => ({
      symbol: p.symbol,
      size: parseFloat(p.size?.toString() || '0'),
      avgCost: parseFloat(p.avgCost?.toString() || '0'),
    }));
  }

  return result;
}

function validateConfig(body: CreateStrategyRequest): string | null {
  if (!body.name || body.name.length < 1 || body.name.length > 100) return 'name must be 1-100 chars';
  if (!body.symbol || !ALL_SYMBOLS.includes(body.symbol as any)) return `Invalid symbol. Valid: ${ALL_SYMBOLS.join(', ')}`;
  if (!body.entryConditions || !Array.isArray(body.entryConditions) || body.entryConditions.length === 0) return 'entryConditions required (non-empty array)';
  for (const c of body.entryConditions) {
    if (!VALID_INDICATORS.includes(c.indicator)) return `Invalid indicator: ${c.indicator}`;
    if (!VALID_OPERATORS.includes(c.operator)) return `Invalid operator: ${c.operator}`;
    if (typeof c.value !== 'number') return 'condition value must be a number';
  }
  if (!body.entryAction) return 'entryAction required';
  if (!['buy', 'sell'].includes(body.entryAction.side)) return 'entryAction.side must be buy or sell';
  if (!['fixed', 'percent_equity'].includes(body.entryAction.sizeType)) return 'entryAction.sizeType must be fixed or percent_equity';
  if (typeof body.entryAction.size !== 'number' || body.entryAction.size <= 0) return 'entryAction.size must be > 0';
  if (!body.exitConditions) return 'exitConditions required';
  if (body.checkIntervalSeconds !== undefined && body.checkIntervalSeconds < MIN_CHECK_INTERVAL) return `checkIntervalSeconds must be >= ${MIN_CHECK_INTERVAL}`;
  if (typeof body.allocatedCapital !== 'number' || body.allocatedCapital <= 0) return 'allocatedCapital must be > 0';
  return null;
}

export default async function strategyRoutes(fastify: FastifyInstance) {
  const userInclude = { select: { name: true, displayName: true, aiModel: true } };

  // POST /strategies — Deploy new strategy
  fastify.post('/strategies', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.authUser!;
    const body = request.body as CreateStrategyRequest;

    const error = validateConfig(body);
    if (error) return reply.status(400).send({ error });

    // Check max strategies
    const activeCount = await fastify.prisma.strategy.count({
      where: { userId: user.id, status: { in: ['active', 'paused'] } },
    });
    if (activeCount >= MAX_STRATEGIES_PER_USER) {
      return reply.status(400).send({ error: `Max ${MAX_STRATEGIES_PER_USER} active strategies allowed` });
    }

    // Deduct from main account and create strategy in a single locked transaction
    let strategy;
    try {
      strategy = await fastify.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Account" WHERE "userId" = ${user.id} FOR UPDATE`;
        const account = await tx.account.findUnique({ where: { userId: user.id } });
        if (!account) throw new Error('Account not found');
        const cashBalance = parseFloat(account.cashBalance.toString());
        if (cashBalance < body.allocatedCapital) {
          throw new Error(`Insufficient balance. Need: $${body.allocatedCapital.toFixed(2)}, Have: $${cashBalance.toFixed(2)}`);
        }

        await tx.account.update({
          where: { userId: user.id },
          data: { cashBalance: { decrement: new Prisma.Decimal(body.allocatedCapital) } },
        });

        return tx.strategy.create({
          data: {
            userId: user.id,
            name: body.name,
            description: body.description || null,
            symbol: body.symbol,
            visibility: body.visibility || 'public',
            config: {
              entryConditions: body.entryConditions,
              entryAction: body.entryAction,
              exitConditions: body.exitConditions,
              riskLimits: body.riskLimits || {},
            } as unknown as Prisma.InputJsonValue,
            checkIntervalSeconds: body.checkIntervalSeconds || 30,
            allocatedCapital: new Prisma.Decimal(body.allocatedCapital),
            currentCash: new Prisma.Decimal(body.allocatedCapital),
            initialEquity: new Prisma.Decimal(body.allocatedCapital),
          },
          include: { user: userInclude, positions: true },
        });
      });
    } catch (err: any) {
      if (err.message.includes('Insufficient balance') || err.message === 'Account not found') {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }

    await fastify.prisma.strategyLog.create({
      data: { strategyId: strategy.id, event: 'created', details: { allocatedCapital: body.allocatedCapital } },
    });

    return reply.status(201).send(serializeStrategy(strategy));
  });

  // GET /strategies — My strategies
  fastify.get('/strategies', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.authUser!;
    const strategies = await fastify.prisma.strategy.findMany({
      where: { userId: user.id },
      include: { user: userInclude, positions: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ data: strategies.map(serializeStrategy) });
  });

  // GET /strategies/explore — Public strategies
  fastify.get('/strategies/explore', async (request, reply) => {
    const { sort = 'pnl', symbol, limit = '20' } = request.query as any;
    const where: any = {
      visibility: 'public',
      status: { in: ['active', 'paused'] },
      forkedFromId: null,
    };
    if (symbol && symbol !== 'ALL') where.symbol = symbol.toUpperCase();

    const take = Math.min(parseInt(limit) || 20, 50);

    if (sort === 'pnl') {
      // Fetch all matching, compute pnlPct, sort in memory
      const strategies = await fastify.prisma.strategy.findMany({
        where,
        include: { user: userInclude, positions: true },
      });

      const serialized = strategies.map(serializeStrategy);
      serialized.sort((a: any, b: any) => (b.pnlPct || 0) - (a.pnlPct || 0));

      return reply.send({ data: serialized.slice(0, take) });
    }

    let orderBy: any;
    switch (sort) {
      case 'newest': orderBy = { createdAt: 'desc' }; break;
      case 'forks': orderBy = { forkCount: 'desc' }; break;
      case 'trades': orderBy = { totalTrades: 'desc' }; break;
      default: orderBy = { totalPnl: 'desc' }; break;
    }

    const strategies = await fastify.prisma.strategy.findMany({
      where,
      include: { user: userInclude, positions: true },
      orderBy,
      take,
    });

    return reply.send({ data: strategies.map(serializeStrategy) });
  });

  // GET /strategies/explore/:id — Public strategy detail
  fastify.get('/strategies/explore/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await fastify.prisma.strategy.findUnique({
      where: { id },
      include: { user: userInclude, positions: true },
    });
    if (!strategy || strategy.visibility !== 'public') {
      return reply.status(404).send({ error: 'Strategy not found' });
    }
    return reply.send(serializeStrategy(strategy));
  });

  // GET /strategies/:id — My strategy detail
  fastify.get('/strategies/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await fastify.prisma.strategy.findUnique({
      where: { id },
      include: { user: userInclude, positions: true },
    });
    if (!strategy || strategy.userId !== request.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }
    return reply.send(serializeStrategy(strategy));
  });

  // PATCH /strategies/:id — Update strategy (must be paused)
  fastify.patch('/strategies/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const strategy = await fastify.prisma.strategy.findUnique({ where: { id } });
    if (!strategy || strategy.userId !== request.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }
    if (strategy.status !== 'paused') {
      return reply.status(400).send({ error: 'Strategy must be paused to update' });
    }

    const updateData: any = {};
    if (body.name) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.visibility) updateData.visibility = body.visibility;
    if (body.checkIntervalSeconds) {
      if (body.checkIntervalSeconds < MIN_CHECK_INTERVAL) {
        return reply.status(400).send({ error: `checkIntervalSeconds must be >= ${MIN_CHECK_INTERVAL}` });
      }
      updateData.checkIntervalSeconds = body.checkIntervalSeconds;
    }
    if (body.entryConditions || body.entryAction || body.exitConditions || body.riskLimits) {
      const currentConfig = strategy.config as any;
      updateData.config = {
        entryConditions: body.entryConditions || currentConfig.entryConditions,
        entryAction: body.entryAction || currentConfig.entryAction,
        exitConditions: body.exitConditions || currentConfig.exitConditions,
        riskLimits: body.riskLimits || currentConfig.riskLimits,
      };
    }

    const updated = await fastify.prisma.strategy.update({
      where: { id },
      data: updateData,
      include: { user: userInclude, positions: true },
    });
    return reply.send(serializeStrategy(updated));
  });

  // POST /strategies/:id/pause
  fastify.post('/strategies/:id/pause', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await fastify.prisma.strategy.findUnique({ where: { id } });
    if (!strategy || strategy.userId !== request.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }
    if (strategy.status !== 'active') {
      return reply.status(400).send({ error: 'Strategy is not active' });
    }

    const updated = await fastify.prisma.strategy.update({
      where: { id },
      data: { status: 'paused', pauseReason: 'manual' },
      include: { user: userInclude, positions: true },
    });
    await fastify.prisma.strategyLog.create({
      data: { strategyId: id, event: 'paused', details: { reason: 'manual' } },
    });
    return reply.send(serializeStrategy(updated));
  });

  // POST /strategies/:id/resume
  fastify.post('/strategies/:id/resume', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await fastify.prisma.strategy.findUnique({ where: { id } });
    if (!strategy || strategy.userId !== request.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }
    if (strategy.status !== 'paused') {
      return reply.status(400).send({ error: 'Strategy is not paused' });
    }

    const updated = await fastify.prisma.strategy.update({
      where: { id },
      data: { status: 'active', pauseReason: null },
      include: { user: userInclude, positions: true },
    });
    await fastify.prisma.strategyLog.create({
      data: { strategyId: id, event: 'resumed', details: {} },
    });
    return reply.send(serializeStrategy(updated));
  });

  // DELETE /strategies/:id — Stop strategy
  fastify.delete('/strategies/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await fastify.prisma.strategy.findUnique({
      where: { id },
      include: { positions: true },
    });
    if (!strategy || strategy.userId !== request.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }

    const prices = marketData.getPrices();
    const currentCash = parseFloat(strategy.currentCash.toString());

    // Calculate total value of positions at current market price
    let positionsValue = 0;
    for (const pos of strategy.positions) {
      const sz = parseFloat(pos.size.toString());
      const price = prices[pos.symbol] || parseFloat(pos.avgCost.toString());
      positionsValue += sz * price;
    }

    const finalFunds = currentCash + positionsValue;
    const initialEquity = parseFloat(strategy.initialEquity.toString());

    // Calculate profit sharing for forked strategies
    let profitShare = 0;
    let publisherId: string | null = null;
    if (strategy.forkedFromId && finalFunds > initialEquity) {
      const sourceStrategy = await fastify.prisma.strategy.findUnique({
        where: { id: strategy.forkedFromId },
        select: { userId: true },
      });
      if (sourceStrategy) {
        const profit = finalFunds - initialEquity;
        profitShare = profit * 0.10;
        publisherId = sourceStrategy.userId;
      }
    }

    const fundsToUser = finalFunds - profitShare;

    // Return funds to main account, delete positions, stop strategy
    await fastify.prisma.$transaction(async (tx) => {
      // Return funds to user's main account (minus profit share)
      if (fundsToUser > 0) {
        await tx.account.update({
          where: { userId: strategy.userId },
          data: { cashBalance: { increment: new Prisma.Decimal(fundsToUser) } },
        });
      }

      // Pay profit share to strategy publisher
      if (profitShare > 0 && publisherId) {
        await tx.account.update({
          where: { userId: publisherId },
          data: { cashBalance: { increment: new Prisma.Decimal(profitShare) } },
        });

        await tx.profitShare.create({
          data: {
            fromUserId: strategy.userId,
            toUserId: publisherId,
            amount: new Prisma.Decimal(profitShare),
            type: 'fork',
            strategyId: strategy.forkedFromId!,
            totalProfit: new Prisma.Decimal(finalFunds - initialEquity),
            shareRate: new Prisma.Decimal(0.10),
          },
        });
      }

      // Delete strategy positions
      await tx.strategyPosition.deleteMany({ where: { strategyId: id } });

      // Stop the strategy
      await tx.strategy.update({
        where: { id },
        data: { status: 'stopped', currentCash: new Prisma.Decimal(0) },
      });
    });

    // Notify publisher about profit share
    if (profitShare > 0 && publisherId) {
      await fastify.prisma.notification.create({
        data: {
          userId: publisherId,
          type: 'profit_share',
          message: `You earned $${profitShare.toFixed(2)} (10% profit share) from a forked strategy being stopped`,
          resourceId: strategy.forkedFromId!,
        },
      }).catch(() => {});
    }

    await fastify.prisma.strategyLog.create({
      data: {
        strategyId: id,
        event: 'stopped',
        details: { finalFunds, positionsValue, cashReturned: fundsToUser, profitShare, publisherId },
      },
    });

    return reply.send({ success: true, fundsReturned: fundsToUser, profitShare });
  });

  // GET /strategies/:id/logs
  fastify.get('/strategies/:id/logs', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit = '50' } = request.query as any;
    const strategy = await fastify.prisma.strategy.findUnique({ where: { id } });
    if (!strategy || strategy.userId !== request.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }

    const logs = await fastify.prisma.strategyLog.findMany({
      where: { strategyId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 50, 200),
    });

    return reply.send({
      data: logs.map(l => ({
        id: l.id,
        event: l.event,
        details: l.details,
        orderId: l.orderId,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  });

  // POST /strategies/:id/fork — Fork a public strategy
  fastify.post('/strategies/:id/fork', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.authUser!;
    const body = request.body as { allocatedCapital?: number };

    const source = await fastify.prisma.strategy.findUnique({ where: { id } });
    if (!source || source.visibility !== 'public') {
      return reply.status(404).send({ error: 'Strategy not found' });
    }

    if (typeof body.allocatedCapital !== 'number' || body.allocatedCapital <= 0) {
      return reply.status(400).send({ error: 'allocatedCapital must be > 0' });
    }

    // Check max strategies
    const activeCount = await fastify.prisma.strategy.count({
      where: { userId: user.id, status: { in: ['active', 'paused'] } },
    });
    if (activeCount >= MAX_STRATEGIES_PER_USER) {
      return reply.status(400).send({ error: `Max ${MAX_STRATEGIES_PER_USER} active strategies allowed` });
    }

    let forked;
    try {
      forked = await fastify.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Account" WHERE "userId" = ${user.id} FOR UPDATE`;
        const account = await tx.account.findUnique({ where: { userId: user.id } });
        if (!account) throw new Error('Account not found');
        const cashBalance = parseFloat(account.cashBalance.toString());
        if (cashBalance < body.allocatedCapital!) {
          throw new Error(`Insufficient balance. Need: $${body.allocatedCapital!.toFixed(2)}, Have: $${cashBalance.toFixed(2)}`);
        }

        await tx.account.update({
          where: { userId: user.id },
          data: { cashBalance: { decrement: new Prisma.Decimal(body.allocatedCapital!) } },
        });

        const created = await tx.strategy.create({
          data: {
            userId: user.id,
            name: `${source.name} (fork)`,
            description: source.description,
            symbol: source.symbol,
            visibility: 'public',
            config: source.config as any,
            checkIntervalSeconds: source.checkIntervalSeconds,
            forkedFromId: source.id,
            allocatedCapital: new Prisma.Decimal(body.allocatedCapital!),
            currentCash: new Prisma.Decimal(body.allocatedCapital!),
            initialEquity: new Prisma.Decimal(body.allocatedCapital!),
            totalTrades: 0,
            winCount: 0,
            totalPnl: new Prisma.Decimal(0),
          },
          include: { user: userInclude, positions: true },
        });

        await tx.strategy.update({
          where: { id: source.id },
          data: { forkCount: { increment: 1 } },
        });

        return created;
      });
    } catch (err: any) {
      if (err.message.includes('Insufficient balance') || err.message === 'Account not found') {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }

    return reply.status(201).send(serializeStrategy(forked));
  });
}
