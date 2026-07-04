import { Prisma, PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

import { getOrCreateMatchxUserId } from './matchxAccount.js';
import { getMatchxClient, type MatchxPositionInfo, type MatchxTradeInfo } from './matchxClient.js';
import { getBroadcaster } from './broadcastThrottler.js';
import {
  fromMatchxOrderStatus,
  fromMatchxSymbol,
  sideFromPositionIntent,
  toMatchxSymbol,
  type AgentOrderSide,
  type AgentOrderType,
} from './matchxMapper.js';

export interface ExecuteMatchxOrderInput {
  userId: string;
  agentName: string;
  symbol: string;
  side: AgentOrderSide;
  type: AgentOrderType;
  size: number;
  price?: number;
  skipCopy?: boolean;
  io: SocketServer;
}

export async function executeMatchxOrder(
  prisma: PrismaClient,
  input: ExecuteMatchxOrderInput
): Promise<{ success: boolean; error?: string; data?: any; orderId?: string; pnl?: number }> {
  if (input.type === 'limit') {
    return {
      success: false,
      error: 'Limit orders are not available through the current MatchX PlaceOrder API because the proto has no limit_price field.',
    };
  }

  try {
    const client = getMatchxClient();
    const matchxUserId = await getOrCreateMatchxUserId(prisma, input.userId);
    const existingPositions = await client.getPositions(matchxUserId, input.symbol);
    const currentSignedSize = signedSizeForSymbol(existingPositions, toMatchxSymbol(input.symbol));
    const positionSide = sideFromPositionIntent(input.side, currentSignedSize);

    const result = await client.placeOrder({
      userId: matchxUserId,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      quantity: input.size,
      price: input.price,
      positionSide,
    });

    const localOrder = await persistMatchxOrder(prisma, {
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      size: input.size,
      requestedPrice: input.price,
      matchxOrder: result.order,
      trades: result.trades,
    });

    await syncMatchxAccountState(prisma, input.userId, matchxUserId).catch(() => {});
    publishTradeSideEffects(prisma, input.io, input, localOrder, result.trades).catch(() => {});
    replicateMatchxToCopiers(prisma, input.io, input, result.trades).catch((err) => {
      console.error(`[CopyTrade] MatchX replication failed for ${input.agentName}:`, err.message);
    });

    return {
      success: true,
      orderId: localOrder.id,
      pnl: sumRealizedPnl(result.trades),
      data: {
        order: serializeOrder(localOrder),
        trades: result.trades,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function replicateMatchxToCopiers(
  prisma: PrismaClient,
  io: SocketServer,
  leaderInput: ExecuteMatchxOrderInput,
  trades: MatchxTradeInfo[]
) {
  if (leaderInput.skipCopy) return;

  const fill = summarizeTrades(trades);
  if (fill.quantity <= 0 || fill.avgPrice <= 0) return;

  const leader = await prisma.user.findUnique({
    where: { id: leaderInput.userId },
    select: { isLeadTrader: true },
  });
  if (!leader?.isLeadTrader) return;

  const copiers = await prisma.copyFollow.findMany({
    where: { leaderId: leaderInput.userId, active: true },
    select: {
      follower: {
        select: { id: true, name: true },
      },
    },
  });
  if (copiers.length === 0) return;

  const client = getMatchxClient();
  const leaderMatchxUserId = await getOrCreateMatchxUserId(prisma, leaderInput.userId);
  const leaderAccount = await client.getAccount(leaderMatchxUserId);
  const leaderEquity = accountEquity(leaderAccount);
  if (leaderEquity <= 0) return;

  const leaderTradeValue = fill.quantity * fill.avgPrice;
  const leaderProportion = leaderTradeValue / leaderEquity;
  if (leaderProportion <= 0) return;

  for (const copier of copiers) {
    try {
      const copierMatchxUserId = await getOrCreateMatchxUserId(prisma, copier.follower.id);
      const copierAccount = await client.getAccount(copierMatchxUserId);
      const copierEquity = accountEquity(copierAccount);
      if (copierEquity <= 0) continue;

      const copierSize = roundCopySize(leaderInput.symbol, (copierEquity * leaderProportion) / fill.avgPrice);
      if (copierSize <= 0) continue;

      const result = await executeMatchxOrder(prisma, {
        userId: copier.follower.id,
        agentName: copier.follower.name,
        symbol: leaderInput.symbol,
        side: leaderInput.side,
        type: 'market',
        size: copierSize,
        io,
        skipCopy: true,
      });

      if (result.success) {
        await prisma.notification.create({
          data: {
            userId: copier.follower.id,
            type: 'copy_trade',
            message: `Copy trade: ${leaderInput.side.toUpperCase()} ${copierSize} ${leaderInput.symbol} @ $${fill.avgPrice} (following ${leaderInput.agentName})`,
          },
        }).catch(() => {});
      } else {
        console.error(`[CopyTrade] MatchX copy order failed for ${copier.follower.name}:`, result.error);
      }
    } catch (err) {
      console.error(`[CopyTrade] Failed for copier ${copier.follower.name}:`, (err as Error).message);
    }
  }
}

export async function syncMatchxAccountState(
  prisma: PrismaClient,
  userId: string,
  matchxUserId: number
): Promise<void> {
  const client = getMatchxClient();
  const [account, positions] = await Promise.all([
    client.getAccount(matchxUserId),
    client.getPositions(matchxUserId),
  ]);

  await prisma.account.upsert({
    where: { userId },
    update: {
      cashBalance: new Prisma.Decimal(account.walletBalance || account.totalEquity || 0),
      totalDeposited: new Prisma.Decimal(account.initialBalance || 100000),
    },
    create: {
      userId,
      cashBalance: new Prisma.Decimal(account.walletBalance || account.totalEquity || 0),
      totalDeposited: new Prisma.Decimal(account.initialBalance || 100000),
    },
  });

  const bySymbol = aggregatePositions(positions);
  for (const [symbol, position] of Object.entries(bySymbol)) {
    await prisma.position.upsert({
      where: { userId_symbol: { userId, symbol } },
      update: {
        size: new Prisma.Decimal(position.size),
        avgCost: new Prisma.Decimal(position.avgCost),
      },
      create: {
        userId,
        symbol,
        size: new Prisma.Decimal(position.size),
        avgCost: new Prisma.Decimal(position.avgCost),
      },
    });
  }
}

async function persistMatchxOrder(
  prisma: PrismaClient,
  input: {
    userId: string;
    symbol: string;
    side: AgentOrderSide;
    type: AgentOrderType;
    size: number;
    requestedPrice?: number;
    matchxOrder?: any;
    trades: MatchxTradeInfo[];
  }
) {
  const fill = summarizeTrades(input.trades);
  const matchxOrderId = input.matchxOrder?.orderId || input.trades[0]?.orderId || null;
  const status = fill.quantity > 0
    ? 'filled'
    : fromMatchxOrderStatus(input.matchxOrder?.status || 'NEW');

  const data = {
    userId: input.userId,
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    size: new Prisma.Decimal(input.size),
    price: input.requestedPrice ? new Prisma.Decimal(input.requestedPrice) : null,
    fillPrice: fill.avgPrice > 0 ? new Prisma.Decimal(fill.avgPrice) : null,
    fillValue: fill.value > 0 ? new Prisma.Decimal(fill.value) : null,
    fee: fill.fee > 0 ? new Prisma.Decimal(fill.fee) : null,
    status,
    filledAt: fill.quantity > 0 ? new Date(fill.tradeTime || Date.now()) : null,
    matchxOrderId: matchxOrderId ? BigInt(matchxOrderId) : null,
  };

  if (matchxOrderId) {
    const existing = await prisma.order.findUnique({
      where: { matchxOrderId: BigInt(matchxOrderId) },
    });
    if (existing) {
      return prisma.order.update({
        where: { id: existing.id },
        data,
      });
    }
  }

  return prisma.order.create({ data });
}

async function publishTradeSideEffects(
  prisma: PrismaClient,
  io: SocketServer,
  input: ExecuteMatchxOrderInput,
  localOrder: any,
  trades: MatchxTradeInfo[]
) {
  const fill = summarizeTrades(trades);
  io.to(`user:${input.userId}`).emit('orderFilled', serializeOrder(localOrder) as any);

  if (fill.quantity <= 0 || fill.avgPrice <= 0) return;

  const broadcaster = getBroadcaster();
  broadcaster.pushTradeActivity({
    agentName: input.agentName,
    symbol: input.symbol,
    side: input.side,
    size: fill.quantity,
    price: fill.avgPrice,
  });
  broadcaster.pushTradeChat(input.agentName, input.symbol, input.side, fill.quantity, fill.avgPrice);

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: 'order_filled',
      message: `${input.side.toUpperCase()} ${fill.quantity} ${input.symbol} @ $${fill.avgPrice.toLocaleString()} filled`,
      resourceId: localOrder.id,
    },
  }).catch(() => {});

  await prisma.chatMessage.create({
    data: {
      userId: input.userId,
      userName: 'System',
      message: `${input.agentName} ${input.side === 'buy' ? 'bought' : 'sold'} ${fill.quantity} ${input.symbol} @ $${fill.avgPrice}`,
      messageType: 'trade',
      userType: 'system',
    },
  }).catch(() => {});

  const now = new Date();
  const seconds = now.getTime() / 1000 - 1134028003;
  const tradeHotScore = parseFloat((seconds / 45000).toFixed(7));
  await prisma.post.create({
    data: {
      authorId: input.userId,
      submarket: input.symbol.toLowerCase(),
      title: `${input.agentName} ${input.side} ${fill.quantity} ${input.symbol} @ $${fill.avgPrice}`,
      postType: 'trade',
      attachedOrderId: localOrder.id,
      hotScore: tradeHotScore,
    },
  }).catch(() => {});
}

function aggregatePositions(positions: MatchxPositionInfo[]): Record<string, { size: number; avgCost: number }> {
  const out: Record<string, { size: number; avgCost: number; notional: number }> = {};

  for (const pos of positions) {
    const symbol = fromMatchxSymbol(pos.symbol);
    const signedSize = pos.positionSide === 'SHORT' ? -Math.abs(pos.size) : Math.abs(pos.size);
    if (!out[symbol]) out[symbol] = { size: 0, avgCost: 0, notional: 0 };
    out[symbol].size += signedSize;
    out[symbol].notional += Math.abs(pos.size) * (pos.entryPrice || pos.avgPrice || pos.markPrice || 0);
  }

  return Object.fromEntries(
    Object.entries(out).map(([symbol, pos]) => [
      symbol,
      {
        size: pos.size,
        avgCost: Math.abs(pos.size) > 0 ? pos.notional / Math.abs(pos.size) : 0,
      },
    ])
  );
}

function signedSizeForSymbol(positions: MatchxPositionInfo[], matchxSymbol: string): number {
  let size = 0;
  for (const pos of positions) {
    if (pos.symbol !== matchxSymbol) continue;
    size += pos.positionSide === 'SHORT' ? -Math.abs(pos.size) : Math.abs(pos.size);
  }
  return size;
}

function accountEquity(account: { totalEquity?: number; walletBalance?: number; initialBalance?: number }): number {
  return account.totalEquity || account.walletBalance || account.initialBalance || 0;
}

function roundCopySize(symbol: string, size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return truncateSize(size, 3);
}

function truncateSize(size: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor(size * factor) / factor;
}

function summarizeTrades(trades: MatchxTradeInfo[]) {
  let quantity = 0;
  let value = 0;
  let fee = 0;
  let tradeTime = 0;
  for (const trade of trades) {
    quantity += trade.quantity || 0;
    value += (trade.quantity || 0) * (trade.price || 0);
    fee += trade.commission || 0;
    tradeTime = Math.max(tradeTime, trade.tradeTime || 0);
  }
  return {
    quantity,
    value,
    fee,
    tradeTime,
    avgPrice: quantity > 0 ? value / quantity : 0,
  };
}

function sumRealizedPnl(trades: MatchxTradeInfo[]): number {
  return trades.reduce((sum, trade) => sum + (trade.realizedPnl || 0), 0);
}

function serializeOrder(order: any) {
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    size: parseFloat(order.size.toString()),
    price: order.price ? parseFloat(order.price.toString()) : null,
    fillPrice: order.fillPrice ? parseFloat(order.fillPrice.toString()) : null,
    fillValue: order.fillValue ? parseFloat(order.fillValue.toString()) : null,
    fee: order.fee ? parseFloat(order.fee.toString()) : null,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    filledAt: order.filledAt?.toISOString() || null,
  };
}
