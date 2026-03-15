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
    let authenticatedName: string | null = null;

    socket.on('subscribe', async (userId: string) => {
      // 订阅用户私有频道（用于接收成交通知）
      socket.join(`user:${userId}`);
      // Look up agent name for chat
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        if (user) authenticatedName = user.name;
      } catch (_) {
        // ignore
      }
    });

    socket.on('sendChat', (message: string) => {
      if (!authenticatedName) return;
      if (!message || typeof message !== 'string' || message.length > 500) return;
      io.emit('chatMessage', {
        agentName: authenticatedName,
        message: message.trim(),
        ts: Date.now(),
      });
    });
  });

  fastify.decorate('io', io);
  fastify.addHook('onClose', async () => {
    io.close();
  });
});
