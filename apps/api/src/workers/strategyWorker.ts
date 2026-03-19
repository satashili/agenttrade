import { PrismaClient, Prisma } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { marketData } from '../services/binanceFeed.js';
import { executeMarketOrder } from '../services/trading.js';
import {
  fetchKlines,
  evaluateEntryConditions,
  evaluateExitConditions,
  checkRiskLimits,
  calculateOrderSize,
} from '../services/strategyEngine.js';
import type { StrategyConfig } from '@agenttrade/types';

let isRunning = false;

export function startStrategyWorker(prisma: PrismaClient, io: SocketServer) {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const prices = marketData.getPrices();
      if (Object.keys(prices).length === 0) return;

      const now = new Date();

      // Find active strategies that are due for checking
      const strategies = await prisma.strategy.findMany({
        where: {
          status: 'active',
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: new Date(now.getTime() - 5000) } }, // at least 5s since last check
          ],
        },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      for (const strategy of strategies) {
        // Check if this strategy is actually due (based on its interval)
        if (strategy.lastCheckedAt) {
          const elapsed = now.getTime() - strategy.lastCheckedAt.getTime();
          if (elapsed < strategy.checkIntervalSeconds * 1000) continue;
        }

        try {
          await processStrategy(prisma, io, strategy, prices);
        } catch (err: any) {
          console.error(`[StrategyWorker] Error processing strategy ${strategy.id}:`, err.message);
          // Log error
          await prisma.strategyLog.create({
            data: {
              strategyId: strategy.id,
              event: 'error',
              details: { message: err.message },
            },
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error('[StrategyWorker] Error:', err.message);
    } finally {
      isRunning = false;
    }
  }, 2000); // Check every 2 seconds

  console.log('[StrategyWorker] Started');
}

async function processStrategy(
  prisma: PrismaClient,
  io: SocketServer,
  strategy: any,
  prices: Record<string, number>
) {
  const config = strategy.config as StrategyConfig;
  const currentPrice = prices[strategy.symbol];
  if (!currentPrice) return;

  // Fetch klines for indicator calculations
  const { closes, candles } = await fetchKlines(strategy.symbol, '1h', 100);
  // Append current price as latest data point
  const allCloses = [...closes, currentPrice];

  // Check risk limits
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const dailyLogs = await prisma.strategyLog.findMany({
    where: {
      strategyId: strategy.id,
      event: 'trade_executed',
      createdAt: { gte: startOfDay },
    },
  });

  const dailyTrades = dailyLogs.length;
  let dailyLoss = 0;
  for (const log of dailyLogs) {
    const details = log.details as any;
    if (details?.pnl && details.pnl < 0) {
      dailyLoss += Math.abs(details.pnl);
    }
  }

  const riskCheck = checkRiskLimits(
    config.riskLimits,
    dailyTrades,
    dailyLoss,
    strategy.lastTriggeredAt
  );

  if (!riskCheck.allowed) {
    // Update lastCheckedAt only
    await prisma.strategy.update({
      where: { id: strategy.id },
      data: { lastCheckedAt: new Date() },
    });
    return;
  }

  // Check current position
  const position = await prisma.position.findUnique({
    where: { userId_symbol: { userId: strategy.userId, symbol: strategy.symbol } },
  });
  const positionSize = position ? parseFloat(position.size.toString()) : 0;
  const avgCost = position ? parseFloat(position.avgCost.toString()) : 0;

  // Get user's equity for position sizing
  const account = await prisma.account.findUnique({ where: { userId: strategy.userId } });
  if (!account) return;
  const cashBalance = parseFloat(account.cashBalance.toString());
  const allPositions = await prisma.position.findMany({ where: { userId: strategy.userId } });
  let equity = cashBalance;
  for (const p of allPositions) {
    const sz = parseFloat(p.size.toString());
    const pr = prices[p.symbol] || parseFloat(p.avgCost.toString());
    equity += sz * pr;
  }

  if (positionSize === 0) {
    // No position — evaluate entry conditions
    const shouldEnter = evaluateEntryConditions(config.entryConditions, allCloses, currentPrice, candles);

    if (shouldEnter) {
      const orderSize = calculateOrderSize(config.entryAction, equity, currentPrice);
      if (orderSize <= 0) {
        await prisma.strategy.update({ where: { id: strategy.id }, data: { lastCheckedAt: new Date() } });
        return;
      }

      // Check max position size
      if (config.riskLimits.maxPositionSize && orderSize > config.riskLimits.maxPositionSize) {
        await prisma.strategy.update({ where: { id: strategy.id }, data: { lastCheckedAt: new Date() } });
        return;
      }

      const result = await executeMarketOrder(
        prisma,
        strategy.userId,
        strategy.symbol,
        config.entryAction.side,
        orderSize,
        currentPrice,
        io,
        strategy.user.name
      );

      if (result.success) {
        await prisma.strategyLog.create({
          data: {
            strategyId: strategy.id,
            event: 'trade_executed',
            details: {
              type: 'entry',
              side: config.entryAction.side,
              size: orderSize,
              price: currentPrice,
              reason: 'entry_conditions_met',
            },
            orderId: result.data?.order?.id || null,
          },
        });

        await prisma.strategy.update({
          where: { id: strategy.id },
          data: {
            lastCheckedAt: new Date(),
            lastTriggeredAt: new Date(),
            totalTrades: { increment: 1 },
          },
        });
      } else {
        await prisma.strategyLog.create({
          data: {
            strategyId: strategy.id,
            event: 'error',
            details: { message: result.error, type: 'entry_failed' },
          },
        });
        await prisma.strategy.update({ where: { id: strategy.id }, data: { lastCheckedAt: new Date() } });
      }
    } else {
      await prisma.strategy.update({ where: { id: strategy.id }, data: { lastCheckedAt: new Date() } });
    }
  } else {
    // Has position — evaluate exit conditions
    const positionSide = positionSize > 0 ? 'long' : 'short';
    const exitResult = evaluateExitConditions(
      config.exitConditions,
      allCloses,
      currentPrice,
      avgCost,
      positionSide as 'long' | 'short',
      candles
    );

    if (exitResult.shouldExit) {
      const closeSide = positionSize > 0 ? 'sell' : 'buy';
      const closeSize = Math.abs(positionSize);

      const result = await executeMarketOrder(
        prisma,
        strategy.userId,
        strategy.symbol,
        closeSide as 'buy' | 'sell',
        closeSize,
        currentPrice,
        io,
        strategy.user.name
      );

      if (result.success) {
        // Calculate PnL for this trade
        const tradePnl = positionSide === 'long'
          ? closeSize * (currentPrice - avgCost)
          : closeSize * (avgCost - currentPrice);
        const isWin = tradePnl > 0;

        await prisma.strategyLog.create({
          data: {
            strategyId: strategy.id,
            event: 'trade_executed',
            details: {
              type: 'exit',
              side: closeSide,
              size: closeSize,
              price: currentPrice,
              reason: exitResult.reason,
              pnl: tradePnl,
            },
            orderId: result.data?.order?.id || null,
          },
        });

        await prisma.strategy.update({
          where: { id: strategy.id },
          data: {
            lastCheckedAt: new Date(),
            lastTriggeredAt: new Date(),
            totalTrades: { increment: 1 },
            totalPnl: { increment: new Prisma.Decimal(tradePnl) },
            winCount: isWin ? { increment: 1 } : undefined,
          },
        });
      } else {
        await prisma.strategy.update({ where: { id: strategy.id }, data: { lastCheckedAt: new Date() } });
      }
    } else {
      await prisma.strategy.update({ where: { id: strategy.id }, data: { lastCheckedAt: new Date() } });
    }
  }
}
