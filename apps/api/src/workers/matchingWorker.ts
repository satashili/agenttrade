import { PrismaClient, Prisma } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { marketData } from '../services/binanceFeed.js';
import { MAX_LEVERAGE } from '../services/trading.js';
import { getBroadcaster } from '../services/broadcastThrottler.js';

let lastPrices: Record<string, number> = {};
let isRunning = false;

export function startMatchingWorker(prisma: PrismaClient, io: SocketServer) {
  // Poll prices from in-memory store every 500ms and check limit orders
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const prices = marketData.getPrices();
      if (Object.keys(prices).length === 0) return;

      // Only process if prices changed
      let hasChange = false;
      for (const [k, v] of Object.entries(prices)) {
        if (lastPrices[k] !== v) { hasChange = true; break; }
      }

      if (!hasChange) return;
      lastPrices = { ...prices };

      await matchLimitOrders(prisma, io, prices);
      await checkLiquidations(prisma, io, prices);

    } catch (err: any) {
      console.error('[MatchingWorker] Error:', err.message);
    } finally {
      isRunning = false;
    }
  }, 500);

  console.log('[MatchingWorker] Started');
}

async function matchLimitOrders(
  prisma: PrismaClient,
  io: SocketServer,
  prices: Record<string, number>
) {
  for (const [symbol, currentPrice] of Object.entries(prices)) {
    const triggeredOrders = await prisma.order.findMany({
      where: {
        symbol,
        status: 'pending',
        OR: [
          { side: 'buy',  type: 'limit', price: { gte: currentPrice } },
          { side: 'sell', type: 'limit', price: { lte: currentPrice } },
          { side: 'sell', type: 'stop',  price: { gte: currentPrice } },
          // Buy stop: triggers when price rises above stop price
          { side: 'buy',  type: 'stop',  price: { lte: currentPrice } },
        ],
      },
      include: {
        user: { select: { name: true } },
      },
    });

    for (const order of triggeredOrders) {
      await fillLimitOrder(prisma, io, order, currentPrice, prices);
    }
  }
}

async function fillLimitOrder(
  prisma: PrismaClient,
  io: SocketServer,
  order: any,
  fillPrice: number,
  allPrices: Record<string, number>
) {
  const size = parseFloat(order.size.toString());
  const fillValue = size * fillPrice;
  const fee = fillValue * 0.001;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Account" WHERE "userId" = ${order.userId} FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { userId: order.userId } });
      if (!account) return;

      const allPositions = await tx.position.findMany({ where: { userId: order.userId } });
      const cashBalance = parseFloat(account.cashBalance.toString());

      const existingPos = allPositions.find(p => p.symbol === order.symbol);
      const currentSize = parseFloat(existingPos?.size.toString() || '0');
      const currentAvgCost = parseFloat(existingPos?.avgCost.toString() || '0');

      const sizeChange = order.side === 'buy' ? size : -size;
      const newSize = currentSize + sizeChange;

      let cashChange: number;
      if (order.side === 'buy') {
        cashChange = -(fillValue + fee);
      } else {
        cashChange = fillValue - fee;
      }

      const newCash = cashBalance + cashChange;

      // Determine if this trade is closing/reducing an existing position
      const isReducingPosition =
        (order.side === 'buy' && currentSize < 0) ||  // buying to close/reduce a short
        (order.side === 'sell' && currentSize > 0);    // selling to close/reduce a long
      const isClosingOnly = isReducingPosition && Math.abs(newSize) <= Math.abs(currentSize);

      if (newCash < 0 && !isClosingOnly) {
        await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
        return;
      }

      // Margin check
      const hypotheticalPositions = allPositions
        .filter(p => p.symbol !== order.symbol)
        .map(p => ({
          size: parseFloat(p.size.toString()),
          price: allPrices[p.symbol] || parseFloat(p.avgCost.toString()),
        }));
      if (newSize !== 0) {
        hypotheticalPositions.push({ size: newSize, price: fillPrice });
      }

      let equity = newCash;
      let totalMargin = 0;
      for (const p of hypotheticalPositions) {
        equity += p.size * p.price;
        totalMargin += (Math.abs(p.size) * p.price) / MAX_LEVERAGE;
      }

      if ((totalMargin > 0 && equity < totalMargin) || equity <= 0) {
        await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
        return;
      }

      // Update cash
      await tx.account.update({
        where: { userId: order.userId },
        data: { cashBalance: new Prisma.Decimal(newCash) },
      });

      // Update position
      await upsertPosition(tx, order.userId, order.symbol, currentSize, currentAvgCost, newSize, fillPrice, order.side);

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'filled',
          fillPrice: new Prisma.Decimal(fillPrice),
          fillValue: new Prisma.Decimal(fillValue),
          fee: new Prisma.Decimal(fee),
          filledAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: order.userId,
          type: 'order_filled',
          message: `${order.side.toUpperCase()} ${size} ${order.symbol} @ $${fillPrice.toLocaleString()} filled`,
          resourceId: order.id,
        },
      });
    });

    // Notify user
    io.to(`user:${order.userId}`).emit('orderFilled', order as any);

    // Queue trade activity for batched broadcast
    const broadcaster = getBroadcaster();
    broadcaster.pushTradeActivity({
      agentName: order.user.name,
      symbol: order.symbol,
      side: order.side,
      size,
      price: fillPrice,
    });

  } catch (err: any) {
    console.error(`[MatchingWorker] Failed to fill order ${order.id}:`, err.message);
  }
}

/**
 * Check all accounts for liquidation.
 * If equity drops to 0 or below, close all positions at market.
 */
async function checkLiquidations(
  prisma: PrismaClient,
  io: SocketServer,
  prices: Record<string, number>
) {
  // Find all accounts that have open positions
  const usersWithPositions = await prisma.user.findMany({
    where: {
      positions: { some: { NOT: { size: 0 } } },
    },
    select: {
      id: true,
      name: true,
      account: { select: { cashBalance: true } },
      positions: { select: { symbol: true, size: true } },
    },
  });

  for (const user of usersWithPositions) {
    if (!user.account) continue;

    const cashBalance = parseFloat(user.account.cashBalance.toString());
    let positionValue = 0;
    let allPricesAvailable = true;

    for (const pos of user.positions) {
      const size = parseFloat(pos.size.toString());
      const price = prices[pos.symbol];
      if (!price || price <= 0) {
        allPricesAvailable = false;
        break;
      }
      positionValue += size * price;
    }

    // Skip liquidation check if any position is missing price data
    if (!allPricesAvailable) continue;

    const equity = cashBalance + positionValue;

    // Liquidation threshold: equity <= 0
    if (equity <= 0) {
      console.log(`[Liquidation] ${user.name} equity=${equity.toFixed(2)}, liquidating all positions`);
      await liquidateUser(prisma, io, user.id, user.name, prices);
    }
  }
}

async function liquidateUser(
  prisma: PrismaClient,
  io: SocketServer,
  userId: string,
  userName: string,
  prices: Record<string, number>
) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Account" WHERE "userId" = ${userId} FOR UPDATE`;
      const positions = await tx.position.findMany({ where: { userId } });

      let totalProceeds = 0;
      for (const pos of positions) {
        const size = parseFloat(pos.size.toString());
        if (size === 0) continue;

        const price = prices[pos.symbol];
        if (!price || price <= 0) continue; // skip symbols with no price data
        const fillValue = Math.abs(size) * price;
        const fee = fillValue * 0.001;

        // Close position: sell if long, buy if short
        const side = size > 0 ? 'sell' : 'buy';
        const proceeds = side === 'sell' ? (fillValue - fee) : -(fillValue + fee);
        totalProceeds += proceeds;

        // Create liquidation order
        await tx.order.create({
          data: {
            userId,
            symbol: pos.symbol,
            side,
            type: 'market',
            size: new Prisma.Decimal(Math.abs(size)),
            fillPrice: new Prisma.Decimal(price),
            fillValue: new Prisma.Decimal(fillValue),
            fee: new Prisma.Decimal(fee),
            status: 'filled',
            filledAt: new Date(),
          },
        });

        // Zero out position
        const avgCost = parseFloat(pos.avgCost.toString());
        const realizedPnl = size > 0
          ? size * (price - avgCost)
          : Math.abs(size) * (avgCost - price);

        await tx.position.update({
          where: { userId_symbol: { userId, symbol: pos.symbol } },
          data: {
            size: 0,
            avgCost: 0,
            realizedPnl: { increment: new Prisma.Decimal(realizedPnl) },
          },
        });
      }

      // Set cash to max(0, current + proceeds)
      const account = await tx.account.findUnique({ where: { userId } });
      const currentCash = parseFloat(account!.cashBalance.toString());
      const newCash = Math.max(0, currentCash + totalProceeds);

      await tx.account.update({
        where: { userId },
        data: { cashBalance: new Prisma.Decimal(newCash) },
      });

      await tx.notification.create({
        data: {
          userId,
          type: 'liquidation',
          message: `LIQUIDATED — All positions closed. Equity reached $0. Remaining cash: $${newCash.toFixed(2)}`,
        },
      });
    });

    io.to(`user:${userId}`).emit('liquidation', { message: 'All positions liquidated due to insufficient equity' });
    getBroadcaster().pushTradeActivity({
      agentName: userName,
      symbol: 'ALL',
      side: 'liquidation',
      size: 0,
      price: 0,
    });

  } catch (err: any) {
    console.error(`[Liquidation] Failed for user ${userId}:`, err.message);
  }
}

async function upsertPosition(
  tx: Prisma.TransactionClient,
  userId: string,
  symbol: string,
  oldSize: number,
  oldAvgCost: number,
  newSize: number,
  fillPrice: number,
  side: string
) {
  // Calculate realized PnL from the closing portion
  let realizedPnl = 0;

  if (side === 'sell' && oldSize > 0 && newSize < oldSize) {
    // Closing part or all of a long
    const closed = Math.min(oldSize, oldSize - newSize);
    realizedPnl = closed * (fillPrice - oldAvgCost);
  } else if (side === 'buy' && oldSize < 0 && newSize > oldSize) {
    // Closing part or all of a short
    const closed = Math.min(Math.abs(oldSize), newSize - oldSize);
    realizedPnl = closed * (oldAvgCost - fillPrice);
  }

  // Calculate new average cost
  let newAvgCost: number;

  if (newSize === 0) {
    newAvgCost = 0;
  } else if (Math.sign(newSize) !== Math.sign(oldSize) && oldSize !== 0) {
    newAvgCost = fillPrice;
  } else if (Math.sign(newSize) === Math.sign(oldSize) && oldSize !== 0) {
    if (Math.abs(newSize) > Math.abs(oldSize)) {
      const addedSize = Math.abs(newSize) - Math.abs(oldSize);
      newAvgCost = (Math.abs(oldSize) * oldAvgCost + addedSize * fillPrice) / Math.abs(newSize);
    } else {
      newAvgCost = oldAvgCost;
    }
  } else {
    newAvgCost = fillPrice;
  }

  await tx.position.upsert({
    where: { userId_symbol: { userId, symbol } },
    update: {
      size: new Prisma.Decimal(newSize),
      avgCost: new Prisma.Decimal(newAvgCost),
      realizedPnl: { increment: new Prisma.Decimal(realizedPnl) },
    },
    create: {
      userId,
      symbol,
      size: new Prisma.Decimal(newSize),
      avgCost: new Prisma.Decimal(newAvgCost),
      realizedPnl: new Prisma.Decimal(realizedPnl),
    },
  });
}
