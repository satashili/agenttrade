import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getOrCreateMatchxUserId } from '../services/matchxAccount.js';
import { getMatchxClient } from '../services/matchxClient.js';
import { defaultMatchxLeverage, fromMatchxSymbol } from '../services/matchxMapper.js';
import { syncMatchxAccountState } from '../services/matchxTrading.js';

export default async function portfolioRoutes(fastify: FastifyInstance) {
  // GET /api/v1/portfolio — Full portfolio with live PnL
  fastify.get('/portfolio', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    let matchxUserId: number;
    try {
      matchxUserId = await getOrCreateMatchxUserId(fastify.prisma, userId);
    } catch (err: any) {
      return reply.status(503).send({ error: 'Matching engine unavailable', details: err.message });
    }

    const client = getMatchxClient();
    const [account, positions] = await Promise.all([
      client.getAccount(matchxUserId),
      client.getPositions(matchxUserId),
    ]);

    syncMatchxAccountState(fastify.prisma, userId, matchxUserId).catch(() => {});

    const cashBalance = account.walletBalance || 0;
    const totalValue = account.totalEquity || cashBalance;
    const totalDeposited = account.initialBalance || 100000;
    const totalPnl = totalValue - totalDeposited;
    const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;
    const totalUnrealizedPnl = account.unrealizedPnl || 0;
    const totalRealizedPnl = 0;
    const totalMarginUsed = account.totalInitialMargin || 0;
    const availableMargin = account.availableBalance || Math.max(0, totalValue - totalMarginUsed);

    const positionsOut: Record<string, any> = {};
    let positionValue = 0;

    for (const pos of positions) {
      const signedSize = pos.positionSide === 'SHORT' ? -Math.abs(pos.size) : Math.abs(pos.size);
      if (signedSize === 0) continue;

      const symbol = fromMatchxSymbol(pos.symbol);
      const currentPrice = pos.markPrice || pos.avgPrice || pos.entryPrice || 0;
      const avgCost = pos.entryPrice || pos.avgPrice || currentPrice;
      const value = signedSize * currentPrice;
      const marginUsed = pos.margin || (Math.abs(signedSize) * currentPrice) / defaultMatchxLeverage();
      positionValue += value;

      positionsOut[symbol] = {
        symbol,
        side: signedSize > 0 ? 'long' : 'short',
        size: signedSize,
        avgCost,
        currentPrice,
        value,
        unrealizedPnl: pos.unrealizedPnl || 0,
        unrealizedPnlPct: pos.unrealizedPnlPercent || 0,
        realizedPnl: 0,
        marginUsed,
        liquidationPrice: pos.liquidationPrice,
      };
    }

    // Add allocation percentages
    for (const key of Object.keys(positionsOut)) {
      const p = positionsOut[key];
      p.allocationPct = totalValue > 0
        ? parseFloat(((Math.abs(p.value) / totalValue) * 100).toFixed(2))
        : 0;
    }

    return reply.send({
      cashBalance,
      positionValue,
      totalValue,
      totalPnl,
      totalPnlPct,
      totalUnrealizedPnl,
      totalRealizedPnl,
      leverage: {
        maxLeverage: defaultMatchxLeverage(),
        totalMarginUsed,
        availableMargin,
        currentLeverage: totalValue > 0
          ? parseFloat(((totalMarginUsed * defaultMatchxLeverage()) / totalValue).toFixed(2))
          : 0,
      },
      positions: positionsOut,
    });
  });

  // GET /api/v1/portfolio/history — Historical PnL curve
  fastify.get('/portfolio/history', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

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
        if (pos.size >= 0) {
          // Adding to long or opening fresh
          pos.avgCost = pos.size === 0 ? price : (pos.size * pos.avgCost + size * price) / newSize;
        } else if (newSize <= 0) {
          // Reducing short — keep avgCost
        } else {
          // Flipping from short to long
          pos.avgCost = price;
        }
        pos.size = newSize;
      } else {
        cash += (value - fee);
        const newSize = pos.size - size;
        if (pos.size <= 0) {
          // Adding to short or opening fresh
          const absOld = Math.abs(pos.size);
          const absNew = Math.abs(newSize);
          pos.avgCost = absOld === 0 ? price : (absOld * pos.avgCost + size * price) / absNew;
        } else if (newSize >= 0) {
          // Reducing long — keep avgCost
        } else {
          // Flipping from long to short
          pos.avgCost = price;
        }
        pos.size = newSize;
      }

      if (pos.size === 0) pos.avgCost = 0;

      // Compute position value
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
