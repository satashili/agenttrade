import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getOrCreateMatchxUserId } from '../services/matchxAccount.js';
import { getMatchxClient, type MatchxPositionInfo } from '../services/matchxClient.js';
import { executeMatchxOrder } from '../services/matchxTrading.js';
import { toMatchxSymbol } from '../services/matchxMapper.js';

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

    if (type === 'limit') {
      return reply.status(501).send({
        error: 'Limit orders are not available through the current MatchX PlaceOrder API because the proto has no limit_price field.',
      });
    }

    if (type === 'stop' && !price) {
      return reply.status(400).send({ error: 'Stop orders require a price' });
    }

    const matchxUserId = await getOrCreateMatchxUserId(fastify.prisma, userId);

    // Handle size: "all" — close entire MatchX position
    if (size === 'all') {
      const positions = await getMatchxClient().getPositions(matchxUserId, symbol);
      const posSize = signedPositionSize(positions, toMatchxSymbol(symbol));

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

    const result = await executeMatchxOrder(fastify.prisma, {
      userId,
      agentName,
      symbol,
      side,
      type,
      size: size as number,
      price,
      io: fastify.io,
    });

    if (!result.success) {
      return reply.status(422).send({ error: result.error });
    }

    return reply.status(201).send(result.data);
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

    const matchxUserId = await getOrCreateMatchxUserId(fastify.prisma, userId);
    const positions = await getMatchxClient().getPositions(matchxUserId, symbol);
    const posSize = signedPositionSize(positions, toMatchxSymbol(symbol));
    if (posSize === 0) {
      return reply.status(422).send({ error: `No ${symbol} position to close` });
    }

    // Long position → sell to close; Short position → buy to close
    const side = posSize > 0 ? 'sell' : 'buy';
    const size = Math.abs(posSize);

    const result = await executeMatchxOrder(fastify.prisma, {
      userId,
      agentName,
      symbol,
      side,
      size,
      type: 'market',
      io: fastify.io,
    });

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
      data: orders.map(serializeOrder),
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
    return reply.send({ order: serializeOrder(order) });
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
    if (!order.matchxOrderId) {
      return reply.status(409).send({ error: 'Order has no MatchX order id and cannot be cancelled in the matching engine' });
    }

    const matchxUserId = await getOrCreateMatchxUserId(fastify.prisma, request.authUser!.id);
    await getMatchxClient().cancelOrder(matchxUserId, Number(order.matchxOrderId), order.symbol);

    await fastify.prisma.order.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    return reply.send({ message: 'Order cancelled' });
  });
}

function signedPositionSize(positions: MatchxPositionInfo[], matchxSymbol: string): number {
  let size = 0;
  for (const pos of positions) {
    if (pos.symbol !== matchxSymbol) continue;
    size += pos.positionSide === 'SHORT' ? -Math.abs(pos.size) : Math.abs(pos.size);
  }
  return size;
}

function serializeOrder(order: any) {
  return {
    id: order.id,
    userId: order.userId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    size: parseFloat(order.size.toString()),
    price: order.price ? parseFloat(order.price.toString()) : null,
    fillPrice: order.fillPrice ? parseFloat(order.fillPrice.toString()) : null,
    fillValue: order.fillValue ? parseFloat(order.fillValue.toString()) : null,
    fee: order.fee ? parseFloat(order.fee.toString()) : null,
    status: order.status,
    matchxOrderId: order.matchxOrderId ? order.matchxOrderId.toString() : null,
    createdAt: order.createdAt.toISOString(),
    filledAt: order.filledAt?.toISOString() || null,
  };
}
