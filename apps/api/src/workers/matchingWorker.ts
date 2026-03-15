import { PrismaClient, Prisma } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { marketData } from '../services/binanceFeed.js';

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
        ],
      },
      include: {
        user: { select: { name: true } },
      },
    });

    for (const order of triggeredOrders) {
      await fillLimitOrder(prisma, io, order, currentPrice);
    }
  }
}

async function fillLimitOrder(prisma: PrismaClient, io: SocketServer, order: any, fillPrice: number) {
  const size = parseFloat(order.size.toString());
  const fillValue = size * fillPrice;
  const fee = fillValue * 0.001;

  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { userId: order.userId } });
      if (!account) return;

      if (order.side === 'buy') {
        const totalCost = fillValue + fee;
        const balance = parseFloat(account.cashBalance.toString());
        if (balance < totalCost) {
          await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
          return;
        }

        await tx.account.update({
          where: { userId: order.userId },
          data: { cashBalance: { decrement: new Prisma.Decimal(totalCost) } },
        });

        await upsertPosition(tx, order.userId, order.symbol, size, fillPrice, 'buy');

      } else {
        const position = await tx.position.findUnique({
          where: { userId_symbol: { userId: order.userId, symbol: order.symbol } },
        });
        const currentSize = parseFloat(position?.size.toString() || '0');
        if (currentSize < size) {
          await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
          return;
        }

        await tx.account.update({
          where: { userId: order.userId },
          data: { cashBalance: { increment: new Prisma.Decimal(fillValue - fee) } },
        });

        await upsertPosition(tx, order.userId, order.symbol, size, fillPrice, 'sell');
      }

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

    // Broadcast public trade activity
    io.emit('tradeActivity', {
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

async function upsertPosition(
  tx: Prisma.TransactionClient,
  userId: string,
  symbol: string,
  size: number,
  price: number,
  side: 'buy' | 'sell'
) {
  const existing = await tx.position.findUnique({
    where: { userId_symbol: { userId, symbol } },
  });

  if (side === 'buy') {
    const oldSize = parseFloat(existing?.size.toString() || '0');
    const oldCost = parseFloat(existing?.avgCost.toString() || price.toString());
    const newSize = oldSize + size;
    const newAvgCost = oldSize === 0 ? price : (oldSize * oldCost + size * price) / newSize;

    await tx.position.upsert({
      where: { userId_symbol: { userId, symbol } },
      update: {
        size: new Prisma.Decimal(newSize),
        avgCost: new Prisma.Decimal(newAvgCost),
      },
      create: { userId, symbol, size, avgCost: price },
    });
  } else {
    if (!existing) return;
    const oldSize = parseFloat(existing.size.toString());
    const avgCost = parseFloat(existing.avgCost.toString());
    const newSize = Math.max(0, oldSize - size);
    const realizedPnl = size * (price - avgCost);

    await tx.position.update({
      where: { userId_symbol: { userId, symbol } },
      data: {
        size: new Prisma.Decimal(newSize),
        avgCost: newSize === 0 ? new Prisma.Decimal(0) : existing.avgCost,
        realizedPnl: { increment: new Prisma.Decimal(realizedPnl) },
      },
    });
  }
}
