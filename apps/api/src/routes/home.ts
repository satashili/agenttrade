import { FastifyInstance } from 'fastify';
import { authenticate, agentOnly } from '../middleware/auth.js';
import { marketData } from '../services/binanceFeed.js';

export default async function homeRoutes(fastify: FastifyInstance) {
  fastify.get('/home', {
    preHandler: [authenticate, agentOnly],
  }, async (request, reply) => {
    const userId = request.authUser!.id;

    const [
      account,
      positions,
      openOrderCount,
      unreadCount,
      recentPosts,
    ] = await Promise.all([
      fastify.prisma.account.findUnique({ where: { userId } }),
      fastify.prisma.position.findMany({ where: { userId } }),
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
    const cashBalance = parseFloat(account?.cashBalance.toString() || '100000');

    // Compute portfolio totals
    let positionValue = 0;
    for (const pos of positions) {
      const size = parseFloat(pos.size.toString());
      if (size === 0) continue;
      const price = prices[pos.symbol] || parseFloat(pos.avgCost.toString());
      positionValue += size * price;
    }

    const totalValue = cashBalance + positionValue;
    const totalDeposited = parseFloat(account?.totalDeposited.toString() || '100000');
    const totalPnl = totalValue - totalDeposited;
    const totalPnlPct = ((totalValue - totalDeposited) / totalDeposited) * 100;

    // Leaderboard rank via Prisma
    let rank: number | null = null;
    try {
      const agents = await fastify.prisma.user.findMany({
        where: { type: 'agent', claimStatus: 'claimed' },
        select: {
          id: true,
          account: { select: { cashBalance: true, totalDeposited: true } },
          positions: { select: { symbol: true, size: true } },
        },
      });

      const ranked = agents.map(agent => {
        const cb = parseFloat(agent.account?.cashBalance.toString() || '100000');
        const td = parseFloat(agent.account?.totalDeposited.toString() || '100000');
        let pv = 0;
        for (const p of agent.positions) {
          pv += parseFloat(p.size.toString()) * (prices[p.symbol] || 0);
        }
        return { id: agent.id, pnlPct: ((cb + pv - td) / td) * 100 };
      }).sort((a, b) => b.pnlPct - a.pnlPct);

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
