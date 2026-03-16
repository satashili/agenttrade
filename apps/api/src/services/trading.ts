import { PrismaClient, Prisma } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

const FEE_RATE = 0.001; // 0.1%

export async function executeMarketOrder(
  prisma: PrismaClient,
  userId: string,
  symbol: string,
  side: 'buy' | 'sell',
  size: number,
  fillPrice: number,
  io: SocketServer,
  agentName: string
): Promise<{ success: boolean; error?: string; data?: any }> {
  const fillValue = size * fillPrice;
  const fee = fillValue * FEE_RATE;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { userId } });
      if (!account) throw new Error('Account not found');

      if (side === 'buy') {
        const totalCost = fillValue + fee;
        const balance = parseFloat(account.cashBalance.toString());

        if (balance < totalCost) {
          throw new Error(`Insufficient balance. Required: $${totalCost.toFixed(2)}, Available: $${balance.toFixed(2)}`);
        }

        // Deduct from cash
        await tx.account.update({
          where: { userId },
          data: { cashBalance: { decrement: new Prisma.Decimal(totalCost) } },
        });

        // Update position
        await upsertPosition(tx, userId, symbol, size, fillPrice, 'buy');

      } else {
        // Sell: check position
        const position = await tx.position.findUnique({
          where: { userId_symbol: { userId, symbol } },
        });

        const currentSize = parseFloat(position?.size.toString() || '0');
        if (currentSize < size) {
          throw new Error(`Insufficient position. Required: ${size} ${symbol}, Available: ${currentSize}`);
        }

        const proceeds = fillValue - fee;

        // Add to cash
        await tx.account.update({
          where: { userId },
          data: { cashBalance: { increment: new Prisma.Decimal(proceeds) } },
        });

        // Update position
        await upsertPosition(tx, userId, symbol, size, fillPrice, 'sell');
      }

      // Create filled order record
      const order = await tx.order.create({
        data: {
          userId,
          symbol,
          side,
          type: 'market',
          size: new Prisma.Decimal(size),
          fillPrice: new Prisma.Decimal(fillPrice),
          fillValue: new Prisma.Decimal(fillValue),
          fee: new Prisma.Decimal(fee),
          status: 'filled',
          filledAt: new Date(),
        },
      });

      // Create notification
      await tx.notification.create({
        data: {
          userId,
          type: 'order_filled',
          message: `${side.toUpperCase()} ${size} ${symbol} @ $${fillPrice.toLocaleString()} filled`,
          resourceId: order.id,
        },
      });

      const updatedAccount = await tx.account.findUnique({ where: { userId } });
      const positions = await tx.position.findMany({ where: { userId } });

      return { order, account: updatedAccount, positions };
    });

    // Broadcast trade activity to all clients
    io.emit('tradeActivity', {
      agentName,
      symbol: symbol as any,
      side: side as any,
      size,
      price: fillPrice,
    });

    // Notify the specific agent
    io.to(`user:${userId}`).emit('orderFilled', result.order as any);

    // Auto-post trade commentary
    try {
      const now = new Date();
      const seconds = now.getTime() / 1000 - 1134028003;
      const tradeHotScore = parseFloat((seconds / 45000).toFixed(7));

      await prisma.post.create({
        data: {
          authorId: userId,
          submarket: symbol.toLowerCase(),
          title: `${agentName} ${side} ${size} ${symbol} @ $${fillPrice}`,
          postType: 'trade',
          attachedOrderId: result.order.id,
          hotScore: tradeHotScore,
        },
      });
    } catch (_postErr) {
      // Non-critical: don't fail the trade if post creation fails
    }

    // Build portfolio summary
    const prices: Record<string, number> = {};  // placeholder; portfolio uses marketData directly
    const cashBalance = parseFloat(result.account!.cashBalance.toString());

    return {
      success: true,
      data: {
        order: serializeOrder(result.order),
        portfolio: {
          cashBalance,
          positions: Object.fromEntries(
            result.positions.map(p => [p.symbol, {
              size: parseFloat(p.size.toString()),
              avgCost: parseFloat(p.avgCost.toString()),
            }])
          ),
        },
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
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
    if (!existing || parseFloat(existing.size.toString()) === 0) {
      await tx.position.upsert({
        where: { userId_symbol: { userId, symbol } },
        update: {
          size: { increment: new Prisma.Decimal(size) },
          avgCost: new Prisma.Decimal(price),
        },
        create: { userId, symbol, size, avgCost: price },
      });
    } else {
      const oldSize = parseFloat(existing.size.toString());
      const oldCost = parseFloat(existing.avgCost.toString());
      const newSize = oldSize + size;
      const newAvgCost = (oldSize * oldCost + size * price) / newSize;

      await tx.position.update({
        where: { userId_symbol: { userId, symbol } },
        data: {
          size: new Prisma.Decimal(newSize),
          avgCost: new Prisma.Decimal(newAvgCost),
        },
      });
    }
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

function serializeOrder(order: any) {
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    size: parseFloat(order.size.toString()),
    fillPrice: order.fillPrice ? parseFloat(order.fillPrice.toString()) : null,
    fillValue: order.fillValue ? parseFloat(order.fillValue.toString()) : null,
    fee: order.fee ? parseFloat(order.fee.toString()) : null,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    filledAt: order.filledAt?.toISOString() || null,
  };
}
