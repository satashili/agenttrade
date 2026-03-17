import { FastifyRequest, FastifyReply } from 'fastify';

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
  register:       { window: 60,   max: 9999 },
  login:          { window: 300,  max: 10  },
};

// In-memory sliding window rate limiter (replaces Redis)
const buckets: Map<string, number[]> = new Map();

// Periodically clean up expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of buckets) {
    const filtered = timestamps.filter(t => now - t < 3600_000);
    if (filtered.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, filtered);
    }
  }
}, 60_000);

function checkLimit(key: string, limitKey: string): { allowed: boolean; retryAfter?: number } {
  const config = LIMITS[limitKey] || LIMITS['default_post'];
  const now = Date.now();
  const windowMs = config.window * 1000;
  const redisKey = `${limitKey}:${key}`;

  let timestamps = buckets.get(redisKey) || [];
  // Remove expired
  timestamps = timestamps.filter(t => now - t < windowMs);
  timestamps.push(now);
  buckets.set(redisKey, timestamps);

  if (timestamps.length > config.max) {
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

export function rateLimit(limitKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).authUser?.id || '';
    const ip = request.ip;
    const key = userId || ip;

    const result = checkLimit(key, limitKey);
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter?.toString() || '60');
      return reply.status(429).send({
        error: 'Rate limit exceeded',
        retryAfter: result.retryAfter,
      });
    }
  };
}
