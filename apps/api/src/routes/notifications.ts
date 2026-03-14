import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get('/notifications', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { limit = '20', cursor } = request.query as Record<string, string>;
    const userId = request.authUser!.id;

    const where: any = { userId };
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const items = await fastify.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) + 1,
    });

    const hasMore = items.length > parseInt(limit);
    if (hasMore) items.pop();

    return reply.send({
      data: items,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
    });
  });

  fastify.post('/notifications/read-all', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    await fastify.prisma.notification.updateMany({
      where: { userId: request.authUser!.id, read: false },
      data: { read: true },
    });
    return reply.send({ message: 'All notifications marked as read' });
  });
}
