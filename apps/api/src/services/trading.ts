import { PrismaClient, Prisma } from '@prisma/client';
import { Server as SocketServer, Server } from 'socket.io';

const FEE_RATE = 0.001; // 0.1%
const MAX_LEVERAGE = 5;

/**
 * Calculate margin requirement for a position.
 * margin = abs(positionValue) / MAX_LEVERAGE
 */
function marginRequired(size: number, price: number): number {
  return (Math.abs(size) * price) / MAX_LEVERAGE;
}

/**
 * Calculate total equity: cash + sum of position market values.
 * For long positions: size * price (positive)
 * For short positions: size * price (negative — since size is negative)
 * Net equity = cash + sum(size * price)
 */
function calcEquity(
  cashBalance: number,
  positions: Array<{ size: number; price: number }>
): number {
  let posValue = 0;
  for (const p of positions) {
    posValue += p.size * p.price;
  }
  return cashBalance + posValue;
}

/**
 * Calculate total margin used across all positions.
 */
function calcTotalMarginUsed(
  positions: Array<{ size: number; price: number }>
): number {
  let margin = 0;
  for (const p of positions) {
    margin += marginRequired(p.size, p.price);
  }
  return margin;
}

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

      const allPositions = await tx.position.findMany({ where: { userId } });
      const cashBalance = parseFloat(account.cashBalance.toString());

      // Get current position for this symbol
      const existingPos = allPositions.find(p => p.symbol === symbol);
      const currentSize = parseFloat(existingPos?.size.toString() || '0');
      const currentAvgCost = parseFloat(existingPos?.avgCost.toString() || '0');

      // Calculate new position size after trade
      const sizeChange = side === 'buy' ? size : -size;
      const newSize = currentSize + sizeChange;

      // Calculate cash change
      let cashChange: number;
      if (side === 'buy') {
        // Buying: pay cash + fee
        cashChange = -(fillValue + fee);
      } else {
        // Selling (close long or open short): receive cash - fee
        cashChange = fillValue - fee;
      }

      const newCash = cashBalance + cashChange;

      // Check: new cash cannot be negative
      if (newCash < 0) {
        throw new Error(`Insufficient balance. Required: $${(-cashChange).toFixed(2)}, Available: $${cashBalance.toFixed(2)}`);
      }

      // Build hypothetical positions array for margin check
      const prices = await getPositionPrices(tx, allPositions, symbol, fillPrice);
      const hypotheticalPositions = allPositions
        .filter(p => p.symbol !== symbol)
        .map(p => ({
          size: parseFloat(p.size.toString()),
          price: prices[p.symbol] || parseFloat(p.avgCost.toString()),
        }));
      // Add the new position for the traded symbol
      if (newSize !== 0) {
        hypotheticalPositions.push({ size: newSize, price: fillPrice });
      }

      const equity = calcEquity(newCash, hypotheticalPositions);
      const totalMargin = calcTotalMarginUsed(hypotheticalPositions);

      // Margin check: equity must cover total margin requirement
      if (totalMargin > 0 && equity < totalMargin) {
        throw new Error(
          `Insufficient margin. Required: $${totalMargin.toFixed(2)}, Equity: $${equity.toFixed(2)} (max ${MAX_LEVERAGE}x leverage)`
        );
      }

      // Equity must stay positive
      if (equity <= 0) {
        throw new Error('Trade would result in negative equity');
      }

      // Update cash
      await tx.account.update({
        where: { userId },
        data: {
          cashBalance: new Prisma.Decimal(newCash),
        },
      });

      // Update position
      await upsertPosition(tx, userId, symbol, currentSize, currentAvgCost, newSize, fillPrice, side);

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
      const updatedPositions = await tx.position.findMany({ where: { userId } });

      return { order, account: updatedAccount, positions: updatedPositions };
    });

    // Broadcast trade activity to all clients
    io.emit('tradeActivity', {
      agentName,
      symbol: symbol as any,
      side: side as any,
      size,
      price: fillPrice,
    });

    // Broadcast trade to live chat
    const sideEmoji = side === 'buy' ? '📈' : '📉';
    const priceStr = fillPrice >= 1000 ? `$${Math.round(fillPrice).toLocaleString()}` : `$${fillPrice.toFixed(2)}`;
    io.emit('chatMessage', {
      agentName: 'System',
      message: `${sideEmoji} ${agentName} ${side === 'buy' ? 'bought' : 'sold'} ${size} ${symbol} @ ${priceStr}`,
      ts: Date.now(),
      type: 'trade',
      userType: 'system',
    } as any);

    // Persist trade chat message (non-blocking)
    prisma.chatMessage.create({
      data: {
        userId,
        userName: 'System',
        message: `${sideEmoji} ${agentName} ${side === 'buy' ? 'bought' : 'sold'} ${size} ${symbol} @ ${priceStr}`,
        messageType: 'trade',
        userType: 'system',
      },
    }).catch(() => {});

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

    // Copy trading: replicate to followers (non-blocking)
    replicateToCopiers(prisma, io, userId, agentName, symbol, side, size, fillPrice).catch(() => {});

    // Build portfolio summary
    const cashBalance = parseFloat(result.account!.cashBalance.toString());

    return {
      success: true,
      data: {
        order: serializeOrder(result.order),
        portfolio: {
          cashBalance,
          positions: Object.fromEntries(
            result.positions
              .filter(p => parseFloat(p.size.toString()) !== 0)
              .map(p => [p.symbol, {
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

/**
 * Get current prices for all positions (using binanceFeed market data at runtime).
 * We pass the traded symbol's fill price explicitly.
 */
async function getPositionPrices(
  _tx: Prisma.TransactionClient,
  positions: Array<{ symbol: string; avgCost: any }>,
  tradedSymbol: string,
  tradedPrice: number
): Promise<Record<string, number>> {
  // Import market data dynamically to avoid circular deps
  const { marketData } = await import('./binanceFeed.js');
  const livePrices = marketData.getPrices();
  const prices: Record<string, number> = {};

  for (const p of positions) {
    if (p.symbol === tradedSymbol) {
      prices[p.symbol] = tradedPrice;
    } else {
      prices[p.symbol] = livePrices[p.symbol] || parseFloat(p.avgCost.toString());
    }
  }

  return prices;
}

/**
 * Update position after a trade. Handles:
 * - Opening long (buy from 0)
 * - Adding to long (buy more)
 * - Closing long (sell to 0)
 * - Reducing long (partial sell)
 * - Opening short (sell from 0)
 * - Adding to short (sell more when already short)
 * - Closing short (buy to cover)
 * - Reducing short (partial buy to cover)
 * - Flipping (long to short or short to long)
 */
async function upsertPosition(
  tx: Prisma.TransactionClient,
  userId: string,
  symbol: string,
  oldSize: number,
  oldAvgCost: number,
  newSize: number,
  fillPrice: number,
  side: 'buy' | 'sell'
) {
  // Calculate realized PnL from the closing portion
  let realizedPnl = 0;

  if (side === 'sell' && oldSize > 0) {
    // Selling while long: closing (partially or fully) a long position
    const closingSize = Math.min(oldSize, oldSize - Math.max(newSize, 0));
    // closingSize = how much of the long we're closing
    const actualClosing = Math.min(Math.abs(oldSize), Math.abs(oldSize - newSize));
    if (oldSize > 0 && newSize < oldSize) {
      const closed = Math.min(oldSize, oldSize - newSize);  // amount closed from long
      const closedFromLong = Math.min(closed, oldSize);  // can't close more than we had
      realizedPnl = closedFromLong * (fillPrice - oldAvgCost);
    }
  } else if (side === 'buy' && oldSize < 0) {
    // Buying while short: closing (partially or fully) a short position
    const closedFromShort = Math.min(Math.abs(oldSize), Math.abs(newSize - oldSize));
    const actualClosed = Math.min(closedFromShort, Math.abs(oldSize));
    // Short PnL: profit when price goes down, loss when price goes up
    realizedPnl = actualClosed * (oldAvgCost - fillPrice);
  }

  // Calculate new average cost
  let newAvgCost: number;

  if (newSize === 0) {
    newAvgCost = 0;
  } else if (Math.sign(newSize) !== Math.sign(oldSize) && oldSize !== 0) {
    // Position flipped — new avgCost is the fill price for the new direction portion
    newAvgCost = fillPrice;
  } else if (Math.sign(newSize) === Math.sign(oldSize) && oldSize !== 0) {
    // Same direction — check if we're adding or reducing
    if (Math.abs(newSize) > Math.abs(oldSize)) {
      // Adding to position: weighted average
      const addedSize = Math.abs(newSize) - Math.abs(oldSize);
      newAvgCost = (Math.abs(oldSize) * oldAvgCost + addedSize * fillPrice) / Math.abs(newSize);
    } else {
      // Reducing position: keep old avgCost
      newAvgCost = oldAvgCost;
    }
  } else {
    // Opening fresh position
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

/**
 * Replicate a leader's trade to all active copy followers.
 * Each copier gets proportional sizing based on their equity vs leader's equity.
 */
async function replicateToCopiers(
  prisma: PrismaClient,
  io: Server,
  leaderId: string,
  leaderName: string,
  symbol: string,
  side: 'buy' | 'sell',
  leaderSize: number,
  fillPrice: number
) {
  // Check if this user is a lead trader
  const leader = await prisma.user.findUnique({
    where: { id: leaderId },
    select: { isLeadTrader: true },
  });
  if (!leader?.isLeadTrader) return;

  // Get active copiers
  const copiers = await prisma.copyFollow.findMany({
    where: { leaderId, active: true },
    select: {
      follower: {
        select: { id: true, name: true },
      },
    },
  });
  if (copiers.length === 0) return;

  // Get leader's equity for proportional sizing
  const { marketData } = await import('./binanceFeed.js');
  const prices = marketData.getPrices();

  const leaderAccount = await prisma.account.findUnique({ where: { userId: leaderId } });
  if (!leaderAccount) return;
  const leaderCash = parseFloat(leaderAccount.cashBalance.toString());
  const leaderPositions = await prisma.position.findMany({ where: { userId: leaderId } });
  let leaderEquity = leaderCash;
  for (const p of leaderPositions) {
    leaderEquity += parseFloat(p.size.toString()) * (prices[p.symbol] || 0);
  }
  if (leaderEquity <= 0) return;

  const leaderTradeValue = leaderSize * fillPrice;
  const leaderProportion = leaderTradeValue / leaderEquity; // e.g. 0.05 = 5% of equity

  for (const copier of copiers) {
    try {
      // Get copier's equity and current position (for PnL calc)
      const copierAccount = await prisma.account.findUnique({ where: { userId: copier.follower.id } });
      if (!copierAccount) continue;
      const copierCash = parseFloat(copierAccount.cashBalance.toString());
      const copierPositions = await prisma.position.findMany({ where: { userId: copier.follower.id } });
      let copierEquity = copierCash;
      for (const p of copierPositions) {
        copierEquity += parseFloat(p.size.toString()) * (prices[p.symbol] || 0);
      }
      if (copierEquity <= 0) continue;

      // Check copier's position before trade (for realized PnL calculation)
      const posBefore = copierPositions.find(p => p.symbol === symbol);
      const sizeBefore = parseFloat(posBefore?.size.toString() || '0');
      const avgCostBefore = parseFloat(posBefore?.avgCost.toString() || '0');

      // Proportional size
      const copierTradeValue = copierEquity * leaderProportion;
      let copierSize = copierTradeValue / fillPrice;

      // Round to reasonable precision
      if (symbol === 'BTC') copierSize = parseFloat(copierSize.toFixed(5));
      else if (symbol === 'ETH') copierSize = parseFloat(copierSize.toFixed(4));
      else copierSize = parseFloat(copierSize.toFixed(2));

      if (copierSize <= 0) continue;

      // Execute the copy trade
      const result = await executeMarketOrder(
        prisma,
        copier.follower.id,
        symbol,
        side,
        copierSize,
        fillPrice,
        io,
        copier.follower.name
      );

      if (result.success) {
        // Notify copier
        await prisma.notification.create({
          data: {
            userId: copier.follower.id,
            type: 'copy_trade',
            message: `Copy trade: ${side.toUpperCase()} ${copierSize} ${symbol} @ $${fillPrice} (following ${leaderName})`,
          },
        }).catch(() => {});

        // Calculate realized PnL from this copy trade for profit sharing
        let realizedPnl = 0;
        if (side === 'sell' && sizeBefore > 0) {
          // Closing/reducing a long
          const closed = Math.min(sizeBefore, copierSize);
          realizedPnl = closed * (fillPrice - avgCostBefore);
        } else if (side === 'buy' && sizeBefore < 0) {
          // Closing/reducing a short
          const closed = Math.min(Math.abs(sizeBefore), copierSize);
          realizedPnl = closed * (avgCostBefore - fillPrice);
        }

        // If profitable, take 10% for the leader
        if (realizedPnl > 0) {
          const share = realizedPnl * 0.10;
          try {
            await prisma.$transaction(async (tx) => {
              // Deduct from copier
              await tx.account.update({
                where: { userId: copier.follower.id },
                data: { cashBalance: { decrement: new Prisma.Decimal(share) } },
              });
              // Credit to leader
              await tx.account.update({
                where: { userId: leaderId },
                data: { cashBalance: { increment: new Prisma.Decimal(share) } },
              });
              // Record profit share
              await tx.profitShare.create({
                data: {
                  fromUserId: copier.follower.id,
                  toUserId: leaderId,
                  amount: new Prisma.Decimal(share),
                  type: 'copy_trade',
                  orderId: result.data?.order?.id || null,
                  totalProfit: new Prisma.Decimal(realizedPnl),
                  shareRate: new Prisma.Decimal(0.10),
                },
              });
            });

            // Notify leader about profit share
            await prisma.notification.create({
              data: {
                userId: leaderId,
                type: 'profit_share',
                message: `You earned $${share.toFixed(2)} (10% profit share) from ${copier.follower.name}'s copy trade`,
              },
            }).catch(() => {});
          } catch (shareErr) {
            console.error(`[CopyTrade] Profit share failed for ${copier.follower.name}:`, (shareErr as Error).message);
          }
        }
      }
    } catch (err) {
      // Non-critical: don't fail the leader's trade
      console.error(`[CopyTrade] Failed for copier ${copier.follower.name}:`, (err as Error).message);
    }
  }
}

export { MAX_LEVERAGE, marginRequired, calcEquity, calcTotalMarginUsed };
