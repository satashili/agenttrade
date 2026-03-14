import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redis.connect();
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
});
