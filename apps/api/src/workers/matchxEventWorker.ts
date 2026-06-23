import { Prisma, PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

import { getMatchxClient, type MatchxTradeInfo } from '../services/matchxClient.js';
import { fromMatchxOrderSide, fromMatchxOrderStatus, fromMatchxOrderType, fromMatchxSymbol } from '../services/matchxMapper.js';
import { syncMatchxAccountState } from '../services/matchxTrading.js';

type Subscription = {
  stream: any;
  userId: string;
  matchxUserId: number;
};

const subscriptions = new Map<number, Subscription>();
let refreshRunning = false;

export function startMatchxEventWorker(prisma: PrismaClient, io: SocketServer) {
  setInterval(() => {
    refreshSubscriptions(prisma, io).catch((err) => {
      console.error('[MatchxEventWorker] refresh failed:', err.message);
    });
  }, 10_000);

  refreshSubscriptions(prisma, io).catch((err) => {
    console.error('[MatchxEventWorker] initial refresh failed:', err.message);
  });

  console.log('[MatchxEventWorker] Started');
}

async function refreshSubscriptions(prisma: PrismaClient, io: SocketServer) {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const accounts = await prisma.matchxAccount.findMany({
      select: { userId: true, matchxUserId: true },
    });

    for (const account of accounts) {
      const matchxUserId = Number(account.matchxUserId);
      if (subscriptions.has(matchxUserId)) continue;
      subscribeAccount(prisma, io, account.userId, matchxUserId);
    }
  } finally {
    refreshRunning = false;
  }
}

function subscribeAccount(prisma: PrismaClient, io: SocketServer, userId: string, matchxUserId: number) {
  const stream = getMatchxClient().subscribeAccountEvents(matchxUserId);
  const sub = { stream, userId, matchxUserId };
  subscriptions.set(matchxUserId, sub);

  stream.on('data', (event: any) => {
    handleAccountEvent(prisma, io, userId, matchxUserId, event).catch((err) => {
      console.error(`[MatchxEventWorker] event failed user=${userId}:`, err.message);
    });
  });

  stream.on('error', (err: Error) => {
    console.error(`[MatchxEventWorker] stream error user=${userId}:`, err.message);
    subscriptions.delete(matchxUserId);
  });

  stream.on('end', () => {
    subscriptions.delete(matchxUserId);
  });
}

async function handleAccountEvent(
  prisma: PrismaClient,
  io: SocketServer,
  userId: string,
  matchxUserId: number,
  event: any
) {
  const order = event.orderUpdate || event.order_update;
  const trade = event.tradeUpdate || event.trade_update;
  const position = event.positionUpdate || event.position_update;
  const account = event.accountUpdate || event.account_update;
  const liquidation = event.liquidationUpdate || event.liquidation_update;

  if (order) {
    const localOrder = await upsertOrderUpdate(prisma, userId, order);
    io.to(`user:${userId}`).emit('orderFilled', serializeOrder(localOrder) as any);
  }

  if (trade) {
    const localOrder = await upsertTradeUpdate(prisma, userId, trade);
    io.to(`user:${userId}`).emit('orderFilled', serializeOrder(localOrder) as any);
  }

  if (position || account || trade || liquidation) {
    await syncMatchxAccountState(prisma, userId, matchxUserId).catch(() => {});
  }

  if (liquidation) {
    await prisma.notification.create({
      data: {
        userId,
        type: 'liquidation',
        message: `Liquidation: ${fromMatchxSymbol(liquidation.symbol)} ${liquidation.positionSide || liquidation.position_side}`,
      },
    }).catch(() => {});
  }
}

async function upsertOrderUpdate(prisma: PrismaClient, userId: string, order: any) {
  const matchxOrderId = BigInt(order.orderId || order.order_id);
  const symbol = fromMatchxSymbol(order.symbol);
  const side = fromMatchxOrderSide(order.side);
  const type = fromMatchxOrderType(order.type);
  const status = fromMatchxOrderStatus(order.status);
  const filledQty = Number(order.filledQty || order.filled_qty || 0);
  const fillPrice = Number(order.avgFillPrice || order.avg_fill_price || 0);
  const fee = Number(order.commission || 0);
  const filledAt = status === 'filled' ? new Date(Number(order.createTime || order.create_time || Date.now())) : null;

  const data = {
    userId,
    symbol,
    side,
    type,
    size: new Prisma.Decimal(Number(order.quantity || filledQty || 0)),
    price: Number(order.stopPrice || order.stop_price || 0) > 0
      ? new Prisma.Decimal(Number(order.stopPrice || order.stop_price))
      : null,
    fillPrice: fillPrice > 0 ? new Prisma.Decimal(fillPrice) : null,
    fillValue: filledQty > 0 && fillPrice > 0 ? new Prisma.Decimal(filledQty * fillPrice) : null,
    fee: fee > 0 ? new Prisma.Decimal(fee) : null,
    status,
    filledAt,
    matchxOrderId,
  };

  const existing = await prisma.order.findUnique({ where: { matchxOrderId } });
  if (existing) {
    return prisma.order.update({ where: { id: existing.id }, data });
  }
  return prisma.order.create({ data });
}

async function upsertTradeUpdate(prisma: PrismaClient, userId: string, trade: MatchxTradeInfo) {
  const matchxOrderId = BigInt(trade.orderId);
  const symbol = fromMatchxSymbol(trade.symbol);
  const side = fromMatchxOrderSide(trade.side);
  const price = Number(trade.price || 0);
  const quantity = Number(trade.quantity || 0);
  const fee = Number(trade.commission || 0);

  const data = {
    userId,
    symbol,
    side,
    type: 'market' as const,
    size: new Prisma.Decimal(quantity),
    fillPrice: new Prisma.Decimal(price),
    fillValue: new Prisma.Decimal(quantity * price),
    fee: new Prisma.Decimal(fee),
    status: 'filled' as const,
    filledAt: new Date(Number(trade.tradeTime || Date.now())),
    matchxOrderId,
  };

  const existing = await prisma.order.findUnique({ where: { matchxOrderId } });
  if (existing) {
    return prisma.order.update({ where: { id: existing.id }, data });
  }
  return prisma.order.create({ data });
}

function serializeOrder(order: any) {
  return {
    id: order.id,
    userId: order.userId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    size: parseFloat(order.size.toString()),
    price: order.price ? parseFloat(order.price.toString()) : null,
    fillPrice: order.fillPrice ? parseFloat(order.fillPrice.toString()) : null,
    fillValue: order.fillValue ? parseFloat(order.fillValue.toString()) : null,
    fee: order.fee ? parseFloat(order.fee.toString()) : null,
    status: order.status,
    matchxOrderId: order.matchxOrderId ? order.matchxOrderId.toString() : null,
    createdAt: order.createdAt.toISOString(),
    filledAt: order.filledAt?.toISOString() || null,
  };
}
