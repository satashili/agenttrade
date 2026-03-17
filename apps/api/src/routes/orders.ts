import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { executeMarketOrder, MAX_LEVERAGE } from '../services/trading.js';
import { marketData } from '../services/binanceFeed.js';

const placeOrderSchema = z.object({
  symbol: z.enum(['BTC', 'ETH', 'TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR']),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop']),
  size: z.union([z.number().positive().max(1000000), z.literal('all')]),
  price: z.number().positive().optional(),
});

export default async function orderRoutes(fastify: FastifyInstance) {
  // POST /api/v1/orders — Place an order (any authenticated user)
  fastify.post('/orders', {
    preHandler: [authenticate, rateLimit('order')],
  }, async (request, reply) => {
    const body = placeOrderSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid order', details: body.error.flatten() });
    }

    let { symbol, side, type, size, price } = body.data;
    const userId = request.authUser!.id;
    const agentName = request.authUser!.name;

    // Handle size: "all" — close entire position
    if (size === 'all') {
      const position = await fastify.prisma.position.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });
      const posSize = parseFloat(position?.size.toString() || '0');

      if (posSize === 0) {
        return reply.status(422).send({ error: `No ${symbol} position to close` });
      }

      // If long and selling "all", or short and buying "all"
      if ((side === 'sell' && posSize > 0) || (side === 'buy' && posSize < 0)) {
        size = Math.abs(posSize);
      } else {
        return reply.status(422).send({
          error: `Cannot ${side} "all" — your ${symbol} position is ${posSize > 0 ? 'long' : 'short'} ${Math.abs(posSize)}`,
        });
      }
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
        size as number,
        currentPrice,
        fastify.io,
        agentName
      );

      if (!result.success) {
        return reply.status(422).send({ error: result.error });
      }

      return reply.status(201).send(result.data);
    }

    // Limit / Stop order — save as pending with margin check
    const account = await fastify.prisma.account.findUnique({ where: { userId } });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    const orderPrice = price || currentPrice;
    const cashBalance = parseFloat(account.cashBalance.toString());

    if (side === 'buy') {
      // For buy orders, ensure sufficient cash to cover the purchase + fee
      const maxCost = (size as number) * orderPrice * 1.001;
      if (cashBalance < maxCost) {
        return reply.status(422).send({
          error: `Insufficient balance. Required: $${maxCost.toFixed(2)}, Available: $${cashBalance.toFixed(2)}`,
        });
      }
    }

    // For sell orders (short selling), margin will be checked at fill time
    // We just do a basic sanity check here
    if (side === 'sell') {
      const position = await fastify.prisma.position.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });
      const posSize = parseFloat(position?.size.toString() || '0');

      // If selling more than current long position, this will create/extend a short
      // Check approximate margin requirement
      if (posSize < (size as number)) {
        const shortSize = (size as number) - Math.max(posSize, 0);
        const marginNeeded = (shortSize * orderPrice) / MAX_LEVERAGE;
        // Rough equity check
        if (cashBalance < marginNeeded) {
          return reply.status(422).send({
            error: `Insufficient margin for short. Need ~$${marginNeeded.toFixed(2)} margin at ${MAX_LEVERAGE}x leverage`,
          });
        }
      }
    }

    const order = await fastify.prisma.order.create({
      data: { userId, symbol, side, type, size: size as number, price, status: 'pending' },
    });

    return reply.status(201).send({ order });
  });

  // POST /api/v1/orders/close-position — Close entire position in a symbol
  fastify.post('/orders/close-position', {
    preHandler: [authenticate, rateLimit('order')],
  }, async (request, reply) => {
    const schema = z.object({
      symbol: z.enum(['BTC', 'ETH', 'TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR']),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const { symbol } = body.data;
    const userId = request.authUser!.id;
    const agentName = request.authUser!.name;

    const position = await fastify.prisma.position.findUnique({
      where: { userId_symbol: { userId, symbol } },
    });

    const posSize = parseFloat(position?.size.toString() || '0');
    if (posSize === 0) {
      return reply.status(422).send({ error: `No ${symbol} position to close` });
    }

    const prices = marketData.getPrices();
    const currentPrice = prices[symbol];
    if (!currentPrice) {
      return reply.status(503).send({ error: 'Price data unavailable. Please try again.' });
    }

    // Long position → sell to close; Short position → buy to close
    const side = posSize > 0 ? 'sell' : 'buy';
    const size = Math.abs(posSize);

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
  });

  // GET /api/v1/orders — Order history
  fastify.get('/orders', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { status, limit = '20', cursor } = request.query as Record<string, string>;
    const userId = request.authUser!.id;

    const where: any = { userId };
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
    const order = await fastify.prisma.order.findFirst({
      where: { id, userId: request.authUser!.id },
    });
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    return reply.send({ order });
  });

  // DELETE /api/v1/orders/:id — Cancel pending order
  fastify.delete('/orders/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const order = await fastify.prisma.order.findFirst({
      where: { id, userId: request.authUser!.id },
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
