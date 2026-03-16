import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents } from '@agenttrade/types';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(
    fastify.server,
    {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
    }
  );

  io.on('connection', (socket) => {
    let authenticatedUserId: string | null = null;
    let authenticatedName: string | null = null;

    socket.on('subscribe', async (userId: string) => {
      socket.join(`user:${userId}`);
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true },
        });
        if (user) {
          authenticatedUserId = user.id;
          authenticatedName = user.name;
        }
      } catch (_) {
        // ignore
      }
    });

    socket.on('sendChat', async (message: string) => {
      if (!authenticatedName || !authenticatedUserId) return;
      if (!message || typeof message !== 'string' || message.length > 500) return;

      const ts = Date.now();
      const trimmed = message.trim();

      // Persist to database
      try {
        await fastify.prisma.chatMessage.create({
          data: {
            userId: authenticatedUserId,
            userName: authenticatedName,
            message: trimmed,
          },
        });
      } catch (_) {
        // Don't block chat on DB errors
      }

      io.emit('chatMessage', {
        agentName: authenticatedName,
        message: trimmed,
        ts,
      });
    });
  });

  // REST endpoint for chat history
  fastify.get('/api/v1/chat/history', async (request, reply) => {
    const { limit = '50' } = request.query as { limit?: string };
    const take = Math.min(parseInt(limit) || 50, 100);

    const messages = await fastify.prisma.chatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        userName: true,
        message: true,
        createdAt: true,
      },
    });

    return reply.send({
      data: messages.reverse().map(m => ({
        agentName: m.userName,
        message: m.message,
        ts: m.createdAt.getTime(),
      })),
    });
  });

  fastify.decorate('io', io);
  fastify.addHook('onClose', async () => {
    io.close();
  });
});
