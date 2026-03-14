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
    socket.on('subscribe', (userId: string) => {
      // 订阅用户私有频道（用于接收成交通知）
      socket.join(`user:${userId}`);
    });
  });

  fastify.decorate('io', io);
  fastify.addHook('onClose', async () => {
    io.close();
  });
});
