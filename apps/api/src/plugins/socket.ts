import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents } from '@agenttrade/types';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
    trackActivity: (userId: string) => void;
  }
}

// Track active users: userId → last activity timestamp
const activeUsers: Map<string, number> = new Map();
const ACTIVE_WINDOW_MS = 120 * 60 * 1000; // 120 minutes

function getActiveCount(): number {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  let count = 0;
  for (const [uid, ts] of activeUsers) {
    if (ts >= cutoff) {
      count++;
    } else {
      activeUsers.delete(uid);
    }
  }
  return count;
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

  // Expose activity tracker so other routes/middleware can record REST API activity
  function trackActivity(userId: string) {
    activeUsers.set(userId, Date.now());
  }
  fastify.decorate('trackActivity', trackActivity);

  // Broadcast active count every 30 seconds
  const broadcastInterval = setInterval(() => {
    io.emit('onlineCount', getActiveCount());
  }, 30_000);

  io.on('connection', (socket) => {
    let authenticatedUserId: string | null = null;
    let authenticatedName: string | null = null;

    // Emit current active count to newly connected client
    socket.emit('onlineCount', getActiveCount());

    socket.on('subscribe', async (userId: string) => {
      socket.join(`user:${userId}`);
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, type: true },
        });
        if (user) {
          authenticatedUserId = user.id;
          authenticatedName = user.name;
          trackActivity(user.id);
          io.emit('onlineCount', getActiveCount());
        }
      } catch (_) {
        // ignore
      }
    });

    socket.on('sendChat', async (message: string) => {
      if (!authenticatedName || !authenticatedUserId) return;
      if (!message || typeof message !== 'string' || message.length > 500) return;

      trackActivity(authenticatedUserId);

      const ts = Date.now();
      const trimmed = message.trim();

      // Look up user type
      let userType = 'agent';
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { id: authenticatedUserId },
          select: { type: true },
        });
        if (user) userType = user.type;
      } catch (_) {}

      // Persist to database
      try {
        await fastify.prisma.chatMessage.create({
          data: {
            userId: authenticatedUserId,
            userName: authenticatedName,
            message: trimmed,
            messageType: 'chat',
            userType,
          },
        });
      } catch (_) {
        // Don't block chat on DB errors
      }

      io.emit('chatMessage', {
        agentName: authenticatedName,
        message: trimmed,
        ts,
        type: 'chat',
        userType,
      });
    });

    socket.on('disconnect', () => {
      // No decrement needed — count is based on activity window, not connections
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
        messageType: true,
        userType: true,
        createdAt: true,
      },
    });

    const data = messages.reverse().map(m => ({
      agentName: m.userName,
      message: m.message,
      ts: m.createdAt.getTime(),
      type: m.messageType,
      userType: m.userType,
    }));

    // If no messages exist, return a welcome message
    if (data.length === 0) {
      data.push({
        agentName: 'System',
        message: 'Welcome to AgentTrade Live Chat! Trade activity will appear here automatically.',
        ts: Date.now(),
        type: 'system',
        userType: 'system',
      });
    }

    return reply.send({ data });
  });

  // REST endpoint to send chat message (for AI agents via API)
  fastify.post('/api/v1/chat/send', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header) return reply.status(401).send({ error: 'Authorization required' });

    const token = header.split(' ')[1];
    if (!token) return reply.status(401).send({ error: 'Invalid authorization' });

    const user = token.startsWith('at_sk_')
      ? await fastify.prisma.user.findUnique({ where: { apiKey: token }, select: { id: true, name: true, type: true } })
      : null;
    if (!user) return reply.status(401).send({ error: 'Invalid API key' });

    const { message } = request.body as { message?: string };
    if (!message || typeof message !== 'string' || message.length > 500) {
      return reply.status(400).send({ error: 'Message required (max 500 chars)' });
    }

    const trimmed = message.trim();
    const ts = Date.now();

    trackActivity(user.id);

    try {
      await fastify.prisma.chatMessage.create({
        data: {
          userId: user.id,
          userName: user.name,
          message: trimmed,
          messageType: 'chat',
          userType: user.type,
        },
      });
    } catch (_) { }

    io.emit('chatMessage', {
      agentName: user.name,
      message: trimmed,
      ts,
      type: 'chat',
      userType: user.type,
    });

    return reply.send({ message: 'sent' });
  });

  fastify.decorate('io', io);
  fastify.addHook('onClose', async () => {
    clearInterval(broadcastInterval);
    io.close();
  });
});
