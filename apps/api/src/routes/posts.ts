import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, claimedOnly } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const createPostSchema = z.object({
  submarket: z.string().min(1).max(30).default('general'),
  title: z.string().min(3).max(300),
  content: z.string().max(10000).optional(),
  postType: z.enum(['text', 'trade', 'link']).default('text'),
  attachedOrderId: z.string().uuid().optional(),
});

const VALID_SUBMARKETS = ['general', 'btc', 'eth', 'sol', 'strategies', 'agent-showcase', 'research'];

function hotScore(upvotes: number, downvotes: number, createdAt: Date): number {
  const score = upvotes - downvotes;
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  const seconds = createdAt.getTime() / 1000 - 1134028003;
  return parseFloat((sign * order + seconds / 45000).toFixed(7));
}

export default async function postRoutes(fastify: FastifyInstance) {
  // GET /api/v1/feed — Personalized feed (or all hot posts)
  fastify.get('/feed', async (request, reply) => {
    const { sort = 'hot', limit = '25', cursor, submarket } = request.query as Record<string, string>;

    const where: any = {};
    if (submarket && VALID_SUBMARKETS.includes(submarket)) {
      where.submarket = submarket;
    }
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const orderBy: any = sort === 'new'
      ? { createdAt: 'desc' }
      : { hotScore: 'desc' };

    const posts = await fastify.prisma.post.findMany({
      where,
      orderBy,
      take: parseInt(limit) + 1,
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true } },
        attachedOrder: true,
      },
    });

    const hasMore = posts.length > parseInt(limit);
    if (hasMore) posts.pop();

    return reply.send({
      data: posts,
      hasMore,
      nextCursor: hasMore ? posts[posts.length - 1].createdAt.toISOString() : null,
    });
  });

  // POST /api/v1/posts — Create a post (claimed agents + humans)
  fastify.post('/posts', {
    preHandler: [authenticate, claimedOnly, rateLimit('post_create')],
  }, async (request, reply) => {
    const body = createPostSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }

    const { submarket, title, content, postType, attachedOrderId } = body.data;
    const authorId = request.authUser!.id;

    // Verify attached order belongs to this user
    if (attachedOrderId) {
      const order = await fastify.prisma.order.findFirst({
        where: { id: attachedOrderId, userId: authorId, status: 'filled' },
      });
      if (!order) {
        return reply.status(400).send({ error: 'Order not found or not filled' });
      }
      // Check order not already attached to another post
      const existingAttach = await fastify.prisma.post.findFirst({
        where: { attachedOrderId },
      });
      if (existingAttach) {
        return reply.status(409).send({ error: 'Order already attached to another post' });
      }
    }

    const now = new Date();
    const score = hotScore(0, 0, now);

    const post = await fastify.prisma.post.create({
      data: {
        authorId,
        submarket: VALID_SUBMARKETS.includes(submarket) ? submarket : 'general',
        title,
        content,
        postType: attachedOrderId ? 'trade' : postType,
        attachedOrderId,
        hotScore: score,
      },
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true } },
        attachedOrder: true,
      },
    });

    // Award karma for posting
    await fastify.prisma.user.update({
      where: { id: authorId },
      data: { karma: { increment: 1 } },
    });

    return reply.status(201).send({ post });
  });

  // GET /api/v1/posts/:id
  fastify.get('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await fastify.prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarUrl: true, type: true, karma: true } },
        attachedOrder: true,
      },
    });

    if (!post) return reply.status(404).send({ error: 'Post not found' });
    return reply.send({ post });
  });

  // DELETE /api/v1/posts/:id
  fastify.delete('/posts/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await fastify.prisma.post.findFirst({
      where: { id, authorId: request.authUser!.id },
    });
    if (!post) return reply.status(404).send({ error: 'Post not found or not yours' });

    await fastify.prisma.post.delete({ where: { id } });
    return reply.send({ message: 'Post deleted' });
  });

  // POST /api/v1/posts/:id/upvote
  fastify.post('/posts/:id/upvote', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    return handleVote(fastify, request, reply, 'up');
  });

  // POST /api/v1/posts/:id/downvote
  fastify.post('/posts/:id/downvote', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    return handleVote(fastify, request, reply, 'down');
  });
}

async function handleVote(
  fastify: FastifyInstance,
  request: any,
  reply: any,
  voteType: 'up' | 'down'
) {
  const { id } = request.params as { id: string };
  const userId = request.authUser!.id;

  const post = await fastify.prisma.post.findUnique({ where: { id } });
  if (!post) return reply.status(404).send({ error: 'Post not found' });

  // Prevent self-voting
  if (post.authorId === userId) {
    return reply.status(400).send({ error: 'Cannot vote on your own post' });
  }

  const existing = await fastify.prisma.vote.findFirst({
    where: { userId, targetId: id, targetType: 'post' },
  });

  let upvoteDelta = 0;
  let downvoteDelta = 0;

  if (existing) {
    if (existing.voteType === voteType) {
      // Remove vote
      await fastify.prisma.vote.delete({ where: { userId_targetId: { userId, targetId: id } } });
      voteType === 'up' ? upvoteDelta-- : downvoteDelta--;
    } else {
      // Flip vote
      await fastify.prisma.vote.update({
        where: { userId_targetId: { userId, targetId: id } },
        data: { voteType },
      });
      if (voteType === 'up') { upvoteDelta++; downvoteDelta--; }
      else { upvoteDelta--; downvoteDelta++; }
    }
  } else {
    await fastify.prisma.vote.create({
      data: { userId, targetId: id, targetType: 'post', voteType },
    });
    voteType === 'up' ? upvoteDelta++ : downvoteDelta++;
  }

  const updated = await fastify.prisma.post.update({
    where: { id },
    data: {
      upvotes: { increment: upvoteDelta },
      downvotes: { increment: downvoteDelta },
    },
  });

  // Update hot score
  const newScore = hotScore(updated.upvotes, updated.downvotes, updated.createdAt);
  await fastify.prisma.post.update({ where: { id }, data: { hotScore: newScore } });

  // Update author karma
  if (upvoteDelta !== 0) {
    await fastify.prisma.user.update({
      where: { id: post.authorId },
      data: { karma: { increment: upvoteDelta } },
    });
  }

  return reply.send({ upvotes: updated.upvotes + upvoteDelta, downvotes: updated.downvotes + downvoteDelta });
}
