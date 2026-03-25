/**
 * repair-balances.ts
 * 
 * Replays every user's filled orders to recompute:
 *   - Account.cashBalance (correct sum of all cash flows)
 *   - Account.totalDeposited (increased if historical overdraft occurred)
 *   - Position.size, Position.avgCost, Position.realizedPnl
 *
 * Run: cd apps/api && npx tsx scripts/repair-balances.ts
 *      Add --dry-run to preview without writing.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

interface PosState {
  size: number;
  avgCost: number;
  realizedPnl: number;
}

function replayOrders(
  totalDeposited: number,
  orders: Array<{ symbol: string; side: string; size: any; fillPrice: any; fillValue: any; fee: any }>
): { cash: number; minCash: number; positions: Record<string, PosState> } {
  let cash = totalDeposited;
  let minCash = totalDeposited;
  const positions: Record<string, PosState> = {};

  for (const o of orders) {
    const size = parseFloat(o.size.toString());
    const price = parseFloat(o.fillPrice.toString());
    const value = parseFloat(o.fillValue.toString());
    const fee = parseFloat(o.fee.toString());

    cash += o.side === 'buy' ? -(value + fee) : (value - fee);
    if (cash < minCash) minCash = cash;

    if (!positions[o.symbol]) {
      positions[o.symbol] = { size: 0, avgCost: 0, realizedPnl: 0 };
    }
    const pos = positions[o.symbol];
    const oldSize = pos.size;
    const oldAvgCost = pos.avgCost;
    const sizeChange = o.side === 'buy' ? size : -size;
    const newSize = oldSize + sizeChange;

    // Realized PnL from closing portion
    if (o.side === 'sell' && oldSize > 0 && newSize < oldSize) {
      const closed = Math.min(oldSize, oldSize - newSize);
      pos.realizedPnl += closed * (price - oldAvgCost);
    } else if (o.side === 'buy' && oldSize < 0 && newSize > oldSize) {
      const closed = Math.min(Math.abs(oldSize), newSize - oldSize);
      pos.realizedPnl += closed * (oldAvgCost - price);
    }

    // Update avgCost
    if (newSize === 0) {
      pos.avgCost = 0;
    } else if (oldSize !== 0 && Math.sign(newSize) !== Math.sign(oldSize)) {
      pos.avgCost = price;
    } else if (oldSize !== 0 && Math.sign(newSize) === Math.sign(oldSize)) {
      if (Math.abs(newSize) > Math.abs(oldSize)) {
        const added = Math.abs(newSize) - Math.abs(oldSize);
        pos.avgCost = (Math.abs(oldSize) * oldAvgCost + added * price) / Math.abs(newSize);
      }
      // reducing: keep avgCost
    } else {
      pos.avgCost = price;
    }
    pos.size = newSize;
  }

  return { cash, minCash, positions };
}

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — no writes' : '🔧 LIVE REPAIR'}\n`);

  // Temporarily drop CHECK constraint so we can write corrected data
  if (!DRY_RUN) {
    await prisma.$executeRaw`ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_cashBalance_non_negative"`;
  }

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  let fixedAccounts = 0;
  let fixedPositions = 0;

  for (const user of users) {
    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    if (!account) continue;

    const originalDeposited = parseFloat(account.totalDeposited.toString());

    const orders = await prisma.order.findMany({
      where: { userId: user.id, status: 'filled' },
      orderBy: { filledAt: 'asc' },
      select: { symbol: true, side: true, size: true, fillPrice: true, fillValue: true, fee: true },
    });

    if (orders.length === 0) continue;

    const { cash: rawCash, minCash, positions: replayedPositions } = replayOrders(originalDeposited, orders);

    // If cash went negative during replay, the account was overdrafted.
    // Increase totalDeposited to cover the worst deficit, which keeps cash >= 0 at all times.
    let newTotalDeposited = originalDeposited;
    let newCash = rawCash;

    if (minCash < -0.001) {
      const deficit = Math.abs(minCash);
      newTotalDeposited = originalDeposited + deficit;
      newCash = rawCash + deficit;
    }

    // Compare with DB values
    const actualCash = parseFloat(account.cashBalance.toString());
    const cashDiff = Math.abs(actualCash - newCash);
    const depositedDiff = Math.abs(originalDeposited - newTotalDeposited);

    let accountNeedsFix = cashDiff > 0.001 || depositedDiff > 0.001;

    // Check positions
    const dbPositions = await prisma.position.findMany({ where: { userId: user.id } });
    const posUpdates: Array<{ symbol: string; size: number; avgCost: number; realizedPnl: number }> = [];

    for (const dbPos of dbPositions) {
      const replayed = replayedPositions[dbPos.symbol] || { size: 0, avgCost: 0, realizedPnl: 0 };
      const dbSize = parseFloat(dbPos.size.toString());
      const dbAvgCost = parseFloat(dbPos.avgCost.toString());
      const dbPnl = parseFloat(dbPos.realizedPnl.toString());

      if (
        Math.abs(dbSize - replayed.size) > 0.000001 ||
        Math.abs(dbAvgCost - replayed.avgCost) > 0.001 ||
        Math.abs(dbPnl - replayed.realizedPnl) > 0.01
      ) {
        posUpdates.push({ symbol: dbPos.symbol, ...replayed });
      }
    }

    if (!accountNeedsFix && posUpdates.length === 0) continue;

    // Log
    if (accountNeedsFix) {
      console.log(`[${user.name}] cash: ${actualCash.toFixed(2)} → ${newCash.toFixed(2)} | deposited: ${originalDeposited.toFixed(0)} → ${newTotalDeposited.toFixed(2)}`);
    }
    if (posUpdates.length > 0) {
      for (const pu of posUpdates) {
        const dbPos = dbPositions.find(p => p.symbol === pu.symbol)!;
        console.log(`  ${pu.symbol}: size ${parseFloat(dbPos.size.toString()).toFixed(6)}→${pu.size.toFixed(6)}, avgCost ${parseFloat(dbPos.avgCost.toString()).toFixed(4)}→${pu.avgCost.toFixed(4)}, pnl ${parseFloat(dbPos.realizedPnl.toString()).toFixed(2)}→${pu.realizedPnl.toFixed(2)}`);
      }
    }

    if (DRY_RUN) {
      if (accountNeedsFix) fixedAccounts++;
      fixedPositions += posUpdates.length;
      continue;
    }

    // Write fixes in a transaction
    await prisma.$transaction(async (tx) => {
      if (accountNeedsFix) {
        await tx.account.update({
          where: { userId: user.id },
          data: {
            cashBalance: new Prisma.Decimal(newCash),
            totalDeposited: new Prisma.Decimal(newTotalDeposited),
          },
        });
        fixedAccounts++;
      }

      for (const pu of posUpdates) {
        await tx.position.update({
          where: { userId_symbol: { userId: user.id, symbol: pu.symbol } },
          data: {
            size: new Prisma.Decimal(pu.size),
            avgCost: new Prisma.Decimal(pu.avgCost),
            realizedPnl: new Prisma.Decimal(pu.realizedPnl),
          },
        });
        fixedPositions++;
      }
    });
  }

  // Re-add CHECK constraint
  if (!DRY_RUN) {
    await prisma.$executeRaw`ALTER TABLE "Account" ADD CONSTRAINT "Account_cashBalance_non_negative" CHECK ("cashBalance" >= 0)`;
  }

  console.log(`\n✅ Done. Accounts fixed: ${fixedAccounts}, Positions fixed: ${fixedPositions}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Repair failed:', err);
  process.exit(1);
});
