import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, agentOnly } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { executeMarketOrder } from '../services/trading.js';
import { marketData } from '../services/binanceFeed.js';

const placeOrderSchema = z.object({
  symbol: z.enum(['BTC', 'ETH', 'TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR']),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop']),
  size: z.number().positive().max(1000000),
  price: z.number().positive().optional(),
  onBehalfOf: z.string().uuid().optional(), // human trading on behalf of owned agent
});

export default async function orderRoutes(fastify: FastifyInstance) {
  // POST /api/v1/orders — Place an order (agent or human with owned agent)
  fastify.post('/orders', {
    preHandler: [authenticate, rateLimit('order')],
  }, async (request, reply) => {
    const body = placeOrderSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid order', details: body.error.flatten() });
    }

    const { symbol, side, type, size, price, onBehalfOf } = body.data;
    let userId = request.authUser!.id;
    let agentName = request.authUser!.name;

    // If human is trading on behalf of their agent
    if (request.authUser!.type === 'human') {
      if (!onBehalfOf) {
        return reply.status(400).send({ error: 'Human users must specify onBehalfOf with an agent ID' });
      }
      const agent = await fastify.prisma.user.findFirst({
        where: { id: onBehalfOf, type: 'agent', ownerId: request.authUser!.id },
        select: { id: true, name: true },
      });
      if (!agent) {
        return reply.status(403).send({ error: 'You do not own this agent' });
      }
      userId = agent.id;
      agentName = agent.name;
    } else if (request.authUser!.type !== 'agent') {
      return reply.status(403).send({ error: 'Only agents or agent owners can place orders' });
    }

    // Validate limit/stop orders have a price
    if ((type === 'limit' || type === 'stop') && !price) {
      return reply.status(400).send({ error: 'Limit and stop orders require a price' });
    }

    // Get current price for market orders
    const prices = marketData.getPrices();
    const currentPrice = prices[symbol] || null;

    if (!currentPrice) {
      return reply.status(503).send({ error: 'Price data unavailable. Please try again.' });
    }

    if (type === 'market') {
      const result = await executeMarketOrder(
        fastify.prisma,
        userId,
        symbol,
        side,
        size,
        currentPrice,
        fastify.io,
        agentName
      );

      if (!result.success) {
        return reply.status(422).send({ error: result.error });
      }

      return reply.status(201).send(result.data);
    }

    // Limit / Stop order — save as pending
    const account = await fastify.prisma.account.findUnique({ where: { userId } });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    if (side === 'buy') {
      const maxCost = size * (price || currentPrice) * 1.001;
      if (parseFloat(account.cashBalance.toString()) < maxCost) {
        return reply.status(422).send({
          error: 'Insufficient balance',
          required: maxCost,
          available: parseFloat(account.cashBalance.toString()),
        });
      }
    } else {
      const position = await fastify.prisma.position.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });
      const posSize = parseFloat(position?.size.toString() || '0');
      if (posSize < size) {
        return reply.status(422).send({
          error: 'Insufficient position to sell',
          required: size,
          available: posSize,
        });
      }
    }

    const order = await fastify.prisma.order.create({
      data: { userId, symbol, side, type, size, price, status: 'pending' },
    });

    return reply.status(201).send({ order });
  });

  // Helper: resolve agent IDs accessible by the current user
  async function getAccessibleAgentIds(request: any): Promise<string[]> {
    if (request.authUser!.type === 'agent') return [request.authUser!.id];
    // Human: return owned agent IDs
    const agents = await fastify.prisma.user.findMany({
      where: { ownerId: request.authUser!.id, type: 'agent' },
      select: { id: true },
    });
    return agents.map(a => a.id);
  }

  // GET /api/v1/orders — Order history
  fastify.get('/orders', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { status, limit = '20', cursor } = request.query as Record<string, string>;
    const agentIds = await getAccessibleAgentIds(request);
    if (agentIds.length === 0) return reply.send({ data: [], hasMore: false, nextCursor: null });

    const where: any = { userId: { in: agentIds } };
    if (status) where.status = status;
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const orders = await fastify.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) + 1,
    });

    const hasMore = orders.length > parseInt(limit);
    if (hasMore) orders.pop();

    return reply.send({
      data: orders,
      hasMore,
      nextCursor: hasMore ? orders[orders.length - 1].createdAt.toISOString() : null,
    });
  });

  // GET /api/v1/orders/:id
  fastify.get('/orders/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentIds = await getAccessibleAgentIds(request);
    const order = await fastify.prisma.order.findFirst({
      where: { id, userId: { in: agentIds } },
    });
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    return reply.send({ order });
  });

  // DELETE /api/v1/orders/:id — Cancel pending order
  fastify.delete('/orders/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentIds = await getAccessibleAgentIds(request);

    const order = await fastify.prisma.order.findFirst({
      where: { id, userId: { in: agentIds } },
    });

    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return reply.status(409).send({ error: `Cannot cancel a ${order.status} order` });
    }

    await fastify.prisma.order.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    return reply.send({ message: 'Order cancelled' });
  });
}
