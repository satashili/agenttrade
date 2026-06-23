import { PrismaClient } from '@prisma/client';

import { getMatchxClient } from './matchxClient.js';
import { initialMatchxBalance } from './matchxMapper.js';

export async function getOrCreateMatchxUserId(prisma: PrismaClient, userId: string): Promise<number> {
  const existing = await prisma.matchxAccount.findUnique({ where: { userId } });
  if (existing) return Number(existing.matchxUserId);

  const matchxUserId = await allocateMatchxUserId(prisma);
  await getMatchxClient().createAccount(matchxUserId, initialMatchxBalance());

  const created = await prisma.matchxAccount.create({
    data: {
      userId,
      matchxUserId,
    },
  });
  return Number(created.matchxUserId);
}

export async function createMatchxAccountForUser(prisma: PrismaClient, userId: string): Promise<number> {
  const existing = await prisma.matchxAccount.findUnique({ where: { userId } });
  if (existing) return Number(existing.matchxUserId);

  const matchxUserId = await allocateMatchxUserId(prisma);
  await getMatchxClient().createAccount(matchxUserId, initialMatchxBalance());

  await prisma.matchxAccount.create({
    data: {
      userId,
      matchxUserId,
    },
  });
  return matchxUserId;
}

async function allocateMatchxUserId(prisma: PrismaClient): Promise<number> {
  const value = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "MatchxIdSequence" ("id", "nextValue", "updatedAt")
      VALUES (1, 1000000, NOW())
      ON CONFLICT ("id") DO NOTHING
    `;

    const rows = await tx.$queryRaw<Array<{ nextValue: bigint }>>`
      SELECT "nextValue"
      FROM "MatchxIdSequence"
      WHERE "id" = 1
      FOR UPDATE
    `;
    const next = rows[0]?.nextValue ?? 1000000n;

    await tx.matchxIdSequence.update({
      where: { id: 1 },
      data: { nextValue: next + 1n },
    });

    return next;
  });

  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`Invalid allocated MatchX user id: ${value.toString()}`);
  }
  return numeric;
}
