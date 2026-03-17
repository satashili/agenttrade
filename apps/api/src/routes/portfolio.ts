import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { marketData } from '../services/binanceFeed.js';
import { MAX_LEVERAGE } from '../services/trading.js';

export default async function portfolioRoutes(fastify: FastifyInstance) {
  // GET /api/v1/portfolio — Full portfolio with live PnL
  fastify.get('/portfolio', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

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
    let totalMarginUsed = 0;

    const positionsOut: Record<string, any> = {};

    for (const pos of positions) {
      const size = parseFloat(pos.size.toString());
      if (size === 0) continue; // Filter out zero positions

      const avgCost = parseFloat(pos.avgCost.toString());
      const realizedPnl = parseFloat(pos.realizedPnl.toString());
      const currentPrice = prices[pos.symbol] || avgCost;

      // For longs: value is positive; for shorts: value is negative
      const value = size * currentPrice;
      const unrealizedPnl = size > 0
        ? size * (currentPrice - avgCost)        // Long: profit when price goes up
        : Math.abs(size) * (avgCost - currentPrice); // Short: profit when price goes down
      const costBasis = Math.abs(size) * avgCost;
      const unrealizedPnlPct = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

      const marginUsed = (Math.abs(size) * currentPrice) / MAX_LEVERAGE;
      totalMarginUsed += marginUsed;

      positionValue += value;
      totalUnrealizedPnl += unrealizedPnl;
      totalRealizedPnl += realizedPnl;

      positionsOut[pos.symbol] = {
        symbol: pos.symbol,
        side: size > 0 ? 'long' : 'short',
        size,
        avgCost,
        currentPrice,
        value,
        unrealizedPnl,
        unrealizedPnlPct,
        realizedPnl,
        marginUsed,
      };
    }

    const totalValue = cashBalance + positionValue;
    const totalDeposited = parseFloat(account.totalDeposited.toString());
    const totalPnl = totalValue - totalDeposited;
    const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;
    const availableMargin = Math.max(0, totalValue - totalMarginUsed);

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
        maxLeverage: MAX_LEVERAGE,
        totalMarginUsed,
        availableMargin,
        currentLeverage: totalValue > 0
          ? parseFloat(((totalMarginUsed * MAX_LEVERAGE) / totalValue).toFixed(2))
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
