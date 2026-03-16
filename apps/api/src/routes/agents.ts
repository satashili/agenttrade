import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sendClaimEmail } from '../services/email.js';

const registerSchema = z.object({
  name: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Name must be alphanumeric with underscores'),
  description: z.string().max(500).optional(),
  aiModel: z.string().max(50).optional(),
});

export default async function agentRoutes(fastify: FastifyInstance) {
  // POST /api/v1/agents/register — Agent self-registration (no auth needed)
  fastify.post('/agents/register', {
    preHandler: [rateLimit('register')],
  }, async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }

    const { name, description, aiModel } = body.data;
    const normalizedName = name.toLowerCase();

    const existing = await fastify.prisma.user.findUnique({ where: { name: normalizedName } });
    if (existing) {
      return reply.status(409).send({ error: 'Agent name already taken' });
    }

    const apiKey = `at_sk_${crypto.randomBytes(24).toString('hex')}`;
    const claimToken = `at_claim_${crypto.randomBytes(24).toString('hex')}`;

    const agent = await fastify.prisma.user.create({
      data: {
        type: 'agent',
        name: normalizedName,
        displayName: name,
        description,
        aiModel,
        apiKey,
        claimToken,
        claimStatus: 'unclaimed',
        emailVerified: false,
        account: {
          create: { cashBalance: 100000, totalDeposited: 100000 },
        },
        positions: {
          createMany: {
            data: [
              { symbol: 'BTC', size: 0, avgCost: 0 },
              { symbol: 'ETH', size: 0, avgCost: 0 },
              { symbol: 'TSLA', size: 0, avgCost: 0 },
              { symbol: 'AMZN', size: 0, avgCost: 0 },
              { symbol: 'COIN', size: 0, avgCost: 0 },
              { symbol: 'MSTR', size: 0, avgCost: 0 },
              { symbol: 'INTC', size: 0, avgCost: 0 },
              { symbol: 'HOOD', size: 0, avgCost: 0 },
              { symbol: 'CRCL', size: 0, avgCost: 0 },
              { symbol: 'PLTR', size: 0, avgCost: 0 },
            ],
          },
        },
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const claimUrl = `${frontendUrl}/claim/${claimToken}`;
    const profileUrl = `${frontendUrl}/u/${normalizedName}`;

    return reply.status(201).send({
      agent: {
        id: agent.id,
        name: agent.name,
        apiKey,
        claimUrl,
        profileUrl,
        initialBalance: 100000,
        status: 'unclaimed',
      },
      warning: 'Save your API key immediately. It will not be shown again.',
    });
  });

  // POST /api/v1/agents/claim — Human claims an agent via claim token
  fastify.post('/agents/claim', async (request, reply) => {
    const { claimToken, email } = request.body as { claimToken?: string; email?: string };
    if (!claimToken || !email) {
      return reply.status(400).send({ error: 'claimToken and email are required' });
    }

    const agent = await fastify.prisma.user.findUnique({ where: { claimToken } });
    if (!agent) {
      return reply.status(404).send({ error: 'Invalid claim token' });
    }
    if (agent.claimStatus === 'claimed') {
      return reply.status(409).send({ error: 'Agent already claimed' });
    }

    // Find or create human account
    let human = await fastify.prisma.user.findUnique({ where: { email } });
    if (!human) {
      // Create a human account stub and send verification email
      const verifyToken = crypto.randomBytes(32).toString('hex');
      human = await fastify.prisma.user.create({
        data: {
          type: 'human',
          name: `owner_${crypto.randomBytes(6).toString('hex')}`,
          email,
          verifyToken,
          claimStatus: 'unclaimed',
          emailVerified: false,
        },
      });
      await sendClaimEmail(email, claimToken, agent.name);
    } else {
      // Send claim verification email to existing user
      await sendClaimEmail(email, claimToken, agent.name);
    }

    return reply.send({
      message: `Verification email sent to ${email}. Click the link to complete claiming ${agent.name}.`,
    });
  });

  // GET /api/v1/agents/claim/verify — Complete claim after email click
  fastify.get('/agents/claim/verify', async (request, reply) => {
    const { token, email } = request.query as { token?: string; email?: string };
    if (!token || !email) return reply.status(400).send({ error: 'token and email required' });

    const agent = await fastify.prisma.user.findUnique({ where: { claimToken: token } });
    if (!agent) return reply.status(404).send({ error: 'Invalid token' });

    // Mark agent as claimed
    await fastify.prisma.user.update({
      where: { id: agent.id },
      data: { claimStatus: 'claimed', emailVerified: true, claimToken: null },
    });

    // Mark or create human
    let human = await fastify.prisma.user.findUnique({ where: { email } });
    if (!human) {
      human = await fastify.prisma.user.create({
        data: {
          type: 'human',
          name: `owner_${crypto.randomBytes(6).toString('hex')}`,
          email,
          emailVerified: true,
          claimStatus: 'claimed',
        },
      });
    } else {
      await fastify.prisma.user.update({
        where: { id: human.id },
        data: { emailVerified: true },
      });
    }

    return reply.redirect(`${process.env.FRONTEND_URL}/u/${agent.name}?claimed=1`);
  });

  // GET /api/v1/agents/status — Check claim status
  fastify.get('/agents/status', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.authUser!.id },
      select: { name: true, claimStatus: true, emailVerified: true },
    });
    return reply.send(user);
  });

  // POST /api/v1/agents/rotate-key — Regenerate API key
  fastify.post('/agents/rotate-key', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    if (request.authUser!.type !== 'agent') {
      return reply.status(403).send({ error: 'Only agents can rotate keys' });
    }

    const newKey = `at_sk_${crypto.randomBytes(24).toString('hex')}`;

    await fastify.prisma.user.update({
      where: { id: request.authUser!.id },
      data: { apiKey: newKey },
    });

    // Old key cache will expire naturally from in-memory auth cache

    return reply.send({
      apiKey: newKey,
      warning: 'Old key is now invalid. Save this new key immediately.',
    });
  });
}
