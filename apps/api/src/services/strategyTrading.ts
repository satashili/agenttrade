import { PrismaClient, Prisma } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

const FEE_RATE = 0.001;

export async function executeStrategyOrder(
  prisma: PrismaClient,
  strategyId: string,
  userId: string,
  symbol: string,
  side: 'buy' | 'sell',
  size: number,
  fillPrice: number,
  io: SocketServer,
  agentName: string
): Promise<{ success: boolean; error?: string; orderId?: string; pnl?: number }> {
  const fillValue = size * fillPrice;
  const fee = fillValue * FEE_RATE;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const strategy = await tx.strategy.findUnique({ where: { id: strategyId } });
      if (!strategy) throw new Error('Strategy not found');

      const currentCash = parseFloat(strategy.currentCash.toString());

      // Get current strategy position
      const existingPos = await tx.strategyPosition.findUnique({
        where: { strategyId_symbol: { strategyId, symbol } },
      });
      const currentSize = existingPos ? parseFloat(existingPos.size.toString()) : 0;
      const currentAvgCost = existingPos ? parseFloat(existingPos.avgCost.toString()) : 0;

      // Calculate new position
      const sizeChange = side === 'buy' ? size : -size;
      const newSize = currentSize + sizeChange;

      // Calculate cash change
      let cashChange: number;
      if (side === 'buy') {
        cashChange = -(fillValue + fee);
      } else {
        cashChange = fillValue - fee;
      }
      const newCash = currentCash + cashChange;
      if (newCash < 0) throw new Error(`Strategy insufficient funds. Need: $${(-cashChange).toFixed(2)}, Have: $${currentCash.toFixed(2)}`);

      // Calculate realized PnL
      let realizedPnl = 0;
      if (side === 'sell' && currentSize > 0 && newSize < currentSize) {
        const closed = Math.min(currentSize, currentSize - newSize);
        realizedPnl = closed * (fillPrice - currentAvgCost);
      } else if (side === 'buy' && currentSize < 0 && newSize > currentSize) {
        const closed = Math.min(Math.abs(currentSize), newSize - currentSize);
        realizedPnl = closed * (currentAvgCost - fillPrice);
      }

      // Calculate new avg cost
      let newAvgCost: number;
      if (newSize === 0) {
        newAvgCost = 0;
      } else if (Math.sign(newSize) !== Math.sign(currentSize) && currentSize !== 0) {
        newAvgCost = fillPrice;
      } else if (Math.sign(newSize) === Math.sign(currentSize) && currentSize !== 0) {
        if (Math.abs(newSize) > Math.abs(currentSize)) {
          const added = Math.abs(newSize) - Math.abs(currentSize);
          newAvgCost = (Math.abs(currentSize) * currentAvgCost + added * fillPrice) / Math.abs(newSize);
        } else {
          newAvgCost = currentAvgCost;
        }
      } else {
        newAvgCost = fillPrice;
      }

      // Update strategy cash
      await tx.strategy.update({
        where: { id: strategyId },
        data: { currentCash: new Prisma.Decimal(newCash) },
      });

      // Update strategy position
      await tx.strategyPosition.upsert({
        where: { strategyId_symbol: { strategyId, symbol } },
        update: {
          size: new Prisma.Decimal(newSize),
          avgCost: new Prisma.Decimal(newAvgCost),
        },
        create: {
          strategyId,
          symbol,
          size: new Prisma.Decimal(newSize),
          avgCost: new Prisma.Decimal(newAvgCost),
        },
      });

      // Create order record (with strategyId)
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
          strategyId,
        },
      });

      return { orderId: order.id, realizedPnl };
    });

    // Broadcast trade activity
    io.emit('tradeActivity', {
      agentName,
      symbol: symbol as any,
      side: side as any,
      size,
      price: fillPrice,
    });

    // Broadcast to chat
    const sideEmoji = side === 'buy' ? '\u{1F4C8}' : '\u{1F4C9}';
    const priceStr = fillPrice >= 1000 ? `$${Math.round(fillPrice).toLocaleString()}` : `$${fillPrice.toFixed(2)}`;
    io.emit('chatMessage', {
      agentName: 'System',
      message: `${sideEmoji} ${agentName}'s strategy ${side === 'buy' ? 'bought' : 'sold'} ${size} ${symbol} @ ${priceStr}`,
      ts: Date.now(),
      type: 'trade',
      userType: 'system',
    } as any);

    // Persist chat (non-blocking)
    prisma.chatMessage.create({
      data: {
        userId,
        userName: 'System',
        message: `${sideEmoji} ${agentName}'s strategy ${side === 'buy' ? 'bought' : 'sold'} ${size} ${symbol} @ ${priceStr}`,
        messageType: 'trade',
        userType: 'system',
      },
    }).catch(() => {});

    return { success: true, orderId: result.orderId, pnl: result.realizedPnl };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
