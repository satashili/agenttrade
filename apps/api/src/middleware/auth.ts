import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

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

// In-memory auth cache (replaces Redis)
const authCache: Map<string, { data: AuthUser; expiresAt: number }> = new Map();

function getCached(key: string): AuthUser | null {
  const entry = authCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    authCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: AuthUser, ttlSeconds: number) {
  authCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authCache) {
    if (now > entry.expiresAt) authCache.delete(key);
  }
}, 60_000);

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

  // Agent API Key path
  if (token.startsWith('at_sk_')) {
    const cacheKey = `apikey:${token}`;
    const cached = getCached(cacheKey);

    if (cached) {
      request.authUser = cached;
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

    setCache(cacheKey, authUser, 300);
    request.authUser = authUser;
    return;
  }

  // Human JWT path
  try {
    const payload = await (request.server as any).jwt.verify(token) as any;
    const cacheKey = `jwt:${payload.sub}`;
    const cached = getCached(cacheKey);

    if (cached) {
      request.authUser = cached;
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

    setCache(cacheKey, authUser, 60);
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
