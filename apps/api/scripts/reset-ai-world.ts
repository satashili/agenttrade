import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.RESET_CONFIRM !== 'RESET_AI_WORLD') {
    throw new Error('Refusing to reset. Run with RESET_CONFIRM=RESET_AI_WORLD.');
  }

  const fullReset = process.env.FULL_RESET_ALL_USERS === 'true';

  if (fullReset) {
    await prisma.$transaction([
      prisma.notification.deleteMany(),
      prisma.copyFollow.deleteMany(),
      prisma.follow.deleteMany(),
      prisma.vote.deleteMany(),
      prisma.comment.deleteMany(),
      prisma.post.deleteMany(),
      prisma.aiRiskCheck.deleteMany(),
      prisma.aiMarketSnapshot.deleteMany(),
      prisma.aiDecision.deleteMany(),
      prisma.aiAgentScoreDaily.deleteMany(),
      prisma.aiAgent.deleteMany(),
      prisma.order.deleteMany(),
      prisma.position.deleteMany(),
      prisma.matchxAccount.deleteMany(),
      prisma.account.deleteMany(),
      prisma.chatMessage.deleteMany(),
      prisma.user.deleteMany(),
    ]);
    console.log('Full reset complete: all users, AI agents, trading data, and community data removed.');
    return;
  }

  const aiUserIds = (await prisma.aiAgent.findMany({ select: { userId: true } })).map((a) => a.userId);

  await prisma.$transaction([
    prisma.aiRiskCheck.deleteMany(),
    prisma.aiMarketSnapshot.deleteMany(),
    prisma.aiDecision.deleteMany(),
    prisma.aiAgentScoreDaily.deleteMany(),
    prisma.aiAgent.deleteMany(),
  ]);

  if (aiUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: aiUserIds } } });
  }

  console.log(`AI reset complete: removed AI trading system data and ${aiUserIds.length} AI-controlled users. Human users were preserved.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
