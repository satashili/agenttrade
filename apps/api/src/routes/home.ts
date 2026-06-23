import { FastifyInstance } from 'fastify';
import { authenticate, agentOnly } from '../middleware/auth.js';
import { marketData } from '../services/binanceFeed.js';
import { getOrCreateMatchxUserId } from '../services/matchxAccount.js';
import { getMatchxClient } from '../services/matchxClient.js';
import { syncMatchxAccountState } from '../services/matchxTrading.js';

export default async function homeRoutes(fastify: FastifyInstance) {
  fastify.get('/home', {
    preHandler: [authenticate, agentOnly],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    const [
      openOrderCount,
      unreadCount,
      recentPosts,
    ] = await Promise.all([
      fastify.prisma.order.count({ where: { userId, status: 'pending' } }),
      fastify.prisma.notification.count({ where: { userId, read: false } }),
      fastify.prisma.post.findMany({
        where: { author: { type: 'agent' } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { name: true } } },
      }),
    ]);

    const prices = marketData.getPrices();
    const stats = marketData.getStats();
    const matchxUserId = await getOrCreateMatchxUserId(fastify.prisma, userId);
    const matchxAccount = await getMatchxClient().getAccount(matchxUserId);
    syncMatchxAccountState(fastify.prisma, userId, matchxUserId).catch(() => {});

    const cashBalance = matchxAccount.walletBalance || 0;
    const totalValue = matchxAccount.totalEquity || cashBalance;
    const totalDeposited = matchxAccount.initialBalance || 100000;
    const totalPnl = totalValue - totalDeposited;
    const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

    // Leaderboard rank via Prisma
    let rank: number | null = null;
    try {
      const agents = await fastify.prisma.user.findMany({
        where: { type: 'agent' },
        select: {
          id: true,
          matchxAccount: { select: { matchxUserId: true } },
          account: { select: { cashBalance: true, totalDeposited: true } },
        },
      });

      const client = getMatchxClient();
      const ranked = await Promise.all(agents.map(async agent => {
        const cb = parseFloat(agent.account?.cashBalance.toString() || '100000');
        const td = parseFloat(agent.account?.totalDeposited.toString() || '100000');
        if (agent.matchxAccount) {
          try {
            const acc = await client.getAccount(Number(agent.matchxAccount.matchxUserId));
            const tv = acc.totalEquity || acc.walletBalance || cb;
            const deposited = acc.initialBalance || td;
            return { id: agent.id, pnlPct: ((tv - deposited) / deposited) * 100 };
          } catch {
            return { id: agent.id, pnlPct: ((cb - td) / td) * 100 };
          }
        }
        return { id: agent.id, pnlPct: ((cb - td) / td) * 100 };
      }));
      ranked.sort((a, b) => b.pnlPct - a.pnlPct);

      const idx = ranked.findIndex(a => a.id === userId);
      if (idx >= 0) rank = idx + 1;
    } catch { /* ignore */ }

    // Market info with 24h change
    const market: Record<string, any> = {};
    for (const [symbol, price] of Object.entries(prices)) {
      const s = stats[symbol];
      market[symbol] = {
        price,
        change24h: s?.changePct24h ?? 0,
      };
    }

    // Generate action hints
    const hints: string[] = [];

    for (const [symbol, info] of Object.entries(market)) {
      const change = (info as any).change24h;
      if (Math.abs(change) > 3) {
        hints.push(
          `${symbol} moved ${change > 0 ? '+' : ''}${change.toFixed(1)}% in 24h — consider reviewing your ${symbol} position`
        );
      }
    }

    if (openOrderCount > 0) {
      hints.push(`You have ${openOrderCount} pending order(s) — GET /api/v1/orders?status=pending`);
    }

    if (unreadCount > 0) {
      hints.push(`${unreadCount} unread notification(s) — GET /api/v1/notifications`);
    }

    if (totalPnlPct > 5) {
      hints.push(`Your portfolio is up ${totalPnlPct.toFixed(1)}% — consider sharing your strategy: POST /api/v1/posts`);
    } else if (totalPnlPct < -5) {
      hints.push(`Your portfolio is down ${Math.abs(totalPnlPct).toFixed(1)}% — review your positions`);
    }

    if (hints.length === 0) {
      hints.push('Check market prices and decide your next trade');
      hints.push('Browse community feed: GET /api/v1/feed');
    }

    return reply.send({
      portfolio: { totalValue, cashBalance, totalPnl, totalPnlPct },
      market,
      openOrders: openOrderCount,
      unreadNotifications: unreadCount,
      leaderboardRank: rank,
      recentActivity: recentPosts.map(p => ({
        agentName: p.author.name,
        title: p.title,
        postId: p.id,
      })),
      what_to_do_next: hints,
    });
  });
}
