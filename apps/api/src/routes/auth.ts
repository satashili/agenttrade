import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sendVerificationEmail } from '../services/email.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/register — Human user registration
  fastify.post('/auth/register', {
    preHandler: [rateLimit('register')],
  }, async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }

    const { email, password, name } = body.data;

    const existing = await fastify.prisma.user.findFirst({
      where: { OR: [{ email }, { name: name.toLowerCase() }] },
    });
    if (existing) {
      return reply.status(409).send({
        error: existing.email === email ? 'Email already registered' : 'Username already taken',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const user = await fastify.prisma.user.create({
      data: {
        type: 'human',
        name: name.toLowerCase(),
        displayName: name,
        email,
        passwordHash,
        verifyToken,
        claimStatus: 'unclaimed',
        emailVerified: false,
      },
    });

    await sendVerificationEmail(email, verifyToken, name);

    return reply.status(201).send({
      message: 'Registration successful. Please check your email to verify your account.',
      userId: user.id,
    });
  });

  // GET /api/v1/auth/verify-email — Email verification
  fastify.get('/auth/verify-email', async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) return reply.status(400).send({ error: 'Token required' });

    const user = await fastify.prisma.user.findFirst({
      where: { verifyToken: token },
    });

    if (!user) {
      return reply.status(400).send({ error: 'Invalid or expired verification token' });
    }

    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verifyToken: null },
    });

    // Redirect to frontend
    return reply.redirect(`${process.env.FRONTEND_URL}/?verified=1`);
  });

  // POST /api/v1/auth/login — Human login
  fastify.post('/auth/login', {
    preHandler: [rateLimit('login')],
  }, async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const { email, password } = body.data;

    const user = await fastify.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, displayName: true, type: true, passwordHash: true, emailVerified: true },
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    if (!user.emailVerified) {
      return reply.status(403).send({ error: 'Please verify your email before logging in' });
    }

    const token = fastify.jwt.sign(
      { sub: user.id, name: user.name, type: user.type },
      { expiresIn: '30d' }
    );

    return reply.send({
      token,
      user: { id: user.id, name: user.name, displayName: user.displayName, type: user.type },
    });
  });

  // GET /api/v1/auth/me — Current user info
  fastify.get('/auth/me', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.authUser!.id },
      select: {
        id: true, type: true, name: true, displayName: true,
        description: true, avatarUrl: true, karma: true,
        emailVerified: true, claimStatus: true, createdAt: true,
      },
    });
    return reply.send({ user });
  });
}
