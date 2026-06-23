import { Prisma, PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

import { executeMatchxOrder } from './matchxTrading.js';

const FEE_RATE = 0.001;

export async function executeStrategyOrder(
  prisma: PrismaClient,
  strategyId: string,
  userId: string,
  symbol: string,
  side: 'buy' | 'sell',
  size: number,
  _referencePrice: number,
  io: SocketServer,
  agentName: string
): Promise<{ success: boolean; error?: string; orderId?: string; pnl?: number }> {
  const result = await executeMatchxOrder(prisma, {
    userId,
    agentName,
    symbol,
    side,
    type: 'market',
    size,
    strategyId,
    io,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const order = result.data?.order;
  if (!order || order.status !== 'filled' || !order.fillPrice) {
    return {
      success: false,
      error: 'Strategy order was accepted by MatchX but did not produce an immediate fill',
    };
  }

  const mirror = await updateStrategyMirror(prisma, {
    strategyId,
    symbol,
    side,
    size,
    fillPrice: order.fillPrice,
    fee: order.fee ?? size * order.fillPrice * FEE_RATE,
  });

  return {
    success: true,
    orderId: result.orderId,
    pnl: mirror.realizedPnl,
  };
}

async function updateStrategyMirror(
  prisma: PrismaClient,
  input: {
    strategyId: string;
    symbol: string;
    side: 'buy' | 'sell';
    size: number;
    fillPrice: number;
    fee: number;
  }
): Promise<{ realizedPnl: number }> {
  return prisma.$transaction(async (tx) => {
    const strategy = await tx.strategy.findUnique({ where: { id: input.strategyId } });
    if (!strategy) throw new Error('Strategy not found');

    const currentCash = parseFloat(strategy.currentCash.toString());
    const existingPos = await tx.strategyPosition.findUnique({
      where: { strategyId_symbol: { strategyId: input.strategyId, symbol: input.symbol } },
    });
    const currentSize = existingPos ? parseFloat(existingPos.size.toString()) : 0;
    const currentAvgCost = existingPos ? parseFloat(existingPos.avgCost.toString()) : 0;

    const fillValue = input.size * input.fillPrice;
    const cashChange = input.side === 'buy'
      ? -(fillValue + input.fee)
      : fillValue - input.fee;
    const newCash = currentCash + cashChange;

    const sizeChange = input.side === 'buy' ? input.size : -input.size;
    const newSize = currentSize + sizeChange;

    let realizedPnl = 0;
    if (input.side === 'sell' && currentSize > 0 && newSize < currentSize) {
      const closed = Math.min(currentSize, currentSize - newSize);
      realizedPnl = closed * (input.fillPrice - currentAvgCost);
    } else if (input.side === 'buy' && currentSize < 0 && newSize > currentSize) {
      const closed = Math.min(Math.abs(currentSize), newSize - currentSize);
      realizedPnl = closed * (currentAvgCost - input.fillPrice);
    }

    let newAvgCost: number;
    if (newSize === 0) {
      newAvgCost = 0;
    } else if (Math.sign(newSize) !== Math.sign(currentSize) && currentSize !== 0) {
      newAvgCost = input.fillPrice;
    } else if (Math.sign(newSize) === Math.sign(currentSize) && currentSize !== 0) {
      if (Math.abs(newSize) > Math.abs(currentSize)) {
        const added = Math.abs(newSize) - Math.abs(currentSize);
        newAvgCost = (Math.abs(currentSize) * currentAvgCost + added * input.fillPrice) / Math.abs(newSize);
      } else {
        newAvgCost = currentAvgCost;
      }
    } else {
      newAvgCost = input.fillPrice;
    }

    await tx.strategy.update({
      where: { id: input.strategyId },
      data: { currentCash: new Prisma.Decimal(newCash) },
    });

    await tx.strategyPosition.upsert({
      where: { strategyId_symbol: { strategyId: input.strategyId, symbol: input.symbol } },
      update: {
        size: new Prisma.Decimal(newSize),
        avgCost: new Prisma.Decimal(newAvgCost),
      },
      create: {
        strategyId: input.strategyId,
        symbol: input.symbol,
        size: new Prisma.Decimal(newSize),
        avgCost: new Prisma.Decimal(newAvgCost),
      },
    });

    return { realizedPnl };
  });
}
