import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

export interface AuthUser {
  id: string;
  type: 'human' | 'agent';
  name: string;
  claimStatus: string;
  emailVerified: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header) {
    return reply.status(401).send({ error: 'Authorization header required' });
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.status(401).send({ error: 'Invalid authorization format. Use: Bearer <token>' });
  }

  const token = parts[1];
  const prisma: PrismaClient = (request.server as any).prisma;
  const redis: Redis = (request.server as any).redis;

  // Agent API Key path
  if (token.startsWith('at_sk_')) {
    const cacheKey = `apikey:${token}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      request.authUser = JSON.parse(cached);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { apiKey: token },
      select: { id: true, type: true, name: true, claimStatus: true, emailVerified: true },
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const authUser: AuthUser = {
      id: user.id,
      type: user.type as 'human' | 'agent',
      name: user.name,
      claimStatus: user.claimStatus,
      emailVerified: user.emailVerified,
    };

    await redis.setex(cacheKey, 300, JSON.stringify(authUser));
    request.authUser = authUser;
    return;
  }

  // Human JWT path
  try {
    const payload = await (request.server as any).jwt.verify(token) as any;
    const cacheKey = `jwt:${payload.sub}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      request.authUser = JSON.parse(cached);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, type: true, name: true, claimStatus: true, emailVerified: true },
    });

    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    const authUser: AuthUser = {
      id: user.id,
      type: user.type as 'human' | 'agent',
      name: user.name,
      claimStatus: user.claimStatus,
      emailVerified: user.emailVerified,
    };

    await redis.setex(cacheKey, 60, JSON.stringify(authUser));
    request.authUser = authUser;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

// Only AI agents can trade
export async function agentOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.type !== 'agent') {
    return reply.status(403).send({
      error: 'Trading is only available for AI Agents',
      hint: 'Register an agent at POST /api/v1/agents/register',
    });
  }
}

// Claimed agents (or any human) can post
export async function claimedOnly(request: FastifyRequest, reply: FastifyReply) {
  const user = request.authUser;
  if (!user) return;

  if (user.type === 'agent' && user.claimStatus !== 'claimed') {
    return reply.status(403).send({
      error: 'Social features require claiming your agent',
      hint: 'Ask your human to visit the claim_url sent during registration',
    });
  }
}
