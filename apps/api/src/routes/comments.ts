import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

export default async function commentRoutes(fastify: FastifyInstance) {
  // GET /api/v1/posts/:id/comments
  fastify.get('/posts/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };

    const comments = await fastify.prisma.comment.findMany({
      where: { postId: id, parentId: null },
      orderBy: { upvotes: 'desc' },
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true } },
          },
        },
      },
    });

    return reply.send({ data: comments });
  });

  // POST /api/v1/posts/:id/comments
  fastify.post('/posts/:id/comments', {
    preHandler: [authenticate, rateLimit('comment_create')],
  }, async (request, reply) => {
    const { id: postId } = request.params as { id: string };
    const body = createCommentSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }

    const post = await fastify.prisma.post.findUnique({ where: { id: postId } });
    if (!post) return reply.status(404).send({ error: 'Post not found' });

    const { content, parentId } = body.data;
    const authorId = request.authUser!.id;

    const comment = await fastify.prisma.comment.create({
      data: { postId, authorId, content, parentId },
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true } },
      },
    });

    // Increment comment count
    await fastify.prisma.post.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    // Notify post author
    if (post.authorId !== authorId) {
      await fastify.prisma.notification.create({
        data: {
          userId: post.authorId,
          type: 'comment',
          actorId: authorId,
          resourceId: postId,
          message: `${request.authUser!.name} commented on your post "${post.title.slice(0, 50)}"`,
        },
      });
    }

    return reply.status(201).send({ comment });
  });

  // POST /api/v1/comments/:id/upvote
  fastify.post('/comments/:id/upvote', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.authUser!.id;

    const comment = await fastify.prisma.comment.findUnique({ where: { id } });
    if (!comment) return reply.status(404).send({ error: 'Comment not found' });
    if (comment.authorId === userId) return reply.status(400).send({ error: 'Cannot vote on your own comment' });

    const existing = await fastify.prisma.vote.findFirst({
      where: { userId, targetId: id, targetType: 'comment' },
    });

    if (existing) {
      await fastify.prisma.vote.delete({ where: { userId_targetId: { userId, targetId: id } } });
      await fastify.prisma.comment.update({ where: { id }, data: { upvotes: { decrement: 1 } } });
    } else {
      await fastify.prisma.vote.create({ data: { userId, targetId: id, targetType: 'comment', voteType: 'up' } });
      await fastify.prisma.comment.update({ where: { id }, data: { upvotes: { increment: 1 } } });
      await fastify.prisma.user.update({ where: { id: comment.authorId }, data: { karma: { increment: 1 } } });
    }

    return reply.send({ message: 'ok' });
  });
}
