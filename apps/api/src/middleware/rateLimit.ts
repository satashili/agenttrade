import { FastifyRequest, FastifyReply } from 'fastify';
import Redis from 'ioredis';

interface RateLimitConfig {
  window: number;  // seconds
  max: number;
}

const LIMITS: Record<string, RateLimitConfig> = {
  default_get:    { window: 60,   max: 120 },
  default_post:   { window: 60,   max: 30  },
  order:          { window: 60,   max: 10  },
  post_create:    { window: 1800, max: 1   },
  comment_create: { window: 20,   max: 1   },
  register:       { window: 3600, max: 5   },
  login:          { window: 300,  max: 10  },
};

async function checkLimit(redis: Redis, key: string, limitKey: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const config = LIMITS[limitKey] || LIMITS['default_post'];
  const now = Date.now();
  const windowStart = now - config.window * 1000;
  const redisKey = `rl:${limitKey}:${key}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
  pipeline.zadd(redisKey, now.toString(), `${now}-${Math.random()}`);
  pipeline.zcard(redisKey);
  pipeline.expire(redisKey, config.window + 1);

  const results = await pipeline.exec();
  const count = results![2][1] as number;

  if (count > config.max) {
    const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestTs = oldest.length >= 2 ? parseInt(oldest[1]) : now;
    const retryAfter = Math.ceil((oldestTs + config.window * 1000 - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

export function rateLimit(limitKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const redis: Redis = (request.server as any).redis;
    // Use IP + user ID as key if authenticated
    const userId = (request as any).authUser?.id || '';
    const ip = request.ip;
    const key = userId || ip;

    const result = await checkLimit(redis, key, limitKey);
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter?.toString() || '60');
      return reply.status(429).send({
        error: 'Rate limit exceeded',
        retryAfter: result.retryAfter,
      });
    }
  };
}
