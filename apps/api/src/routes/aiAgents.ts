import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';

import { ALL_SYMBOLS } from '@agenttrade/types';
import { authenticate } from '../middleware/auth.js';
import { createMatchxAccountForUser } from '../services/matchxAccount.js';
import { marketData } from '../services/binanceFeed.js';
import { matchxEnabled } from '../services/matchxMapper.js';
import { processAiAgent, randomInitialDecisionTime } from '../services/aiTradingEngine.js';

const PERSONALITIES = [
  'aggressive',
  'patient',
  'defensive',
  'analytical',
  'chaotic',
  'buffett_value_oracle',
  'munger_quality_filter',
  'soros_reflexive_macro',
  'dalio_all_weather',
  'lynch_growth_hunter',
  'burry_contrarian_short',
  'simons_quant_machine',
  'druckenmiller_macro_sniper',
  'wood_disruptive_growth',
  'ackman_activist_focus',
  'tudor_jones_risk_tactician',
  'ruckenstein_deep_value',
  'livermore_tape_reader',
  'graham_margin_safety',
  'icahn_event_driven',
  'tepper_distressed_hunter',
  'trump_deal_maker',
  'musk_moonshot_operator',
  'cathie_innovation_bull',
  'renaissance_stat_arb',
] as const;
const STYLES = ['trend_following', 'mean_reversion', 'breakout', 'contrarian', 'defensive'] as const;
const RISK = ['low', 'medium', 'high'] as const;
const SYMBOLS = ALL_SYMBOLS as readonly string[];
const DEFAULT_AI_MODEL = process.env.AI_LLM_MODEL || 'gpt-5.1-mini';

const createSchema = z.object({
  name: z.string().min(2).max(40).optional(),
  symbol: z.enum(SYMBOLS as [string, ...string[]]),
  personality: z.enum(PERSONALITIES),
  investmentStyle: z.enum(STYLES),
  riskPreference: z.enum(RISK),
  model: z.string().max(80).optional(),
  promptVersion: z.string().max(80).optional(),
  decisionIntervalSeconds: z.number().int().min(1800).max(86400).optional(),
  cooldownSeconds: z.number().int().min(1800).max(86400).optional(),
  initialBalance: z.number().positive().max(10_000_000).optional(),
});

const bulkSchema = z.object({
  count: z.number().int().min(1).max(1000),
  symbols: z.array(z.enum(SYMBOLS as [string, ...string[]])).min(1).optional(),
  initialBalance: z.number().positive().max(10_000_000).optional(),
  decisionIntervalSeconds: z.number().int().min(1800).max(86400).optional(),
  cooldownSeconds: z.number().int().min(1800).max(86400).optional(),
});

function serializeAgent(agent: any) {
  const lastDecision = agent.decisions?.[0] || null;
  const mark = markToMarket(agent.user);
  return {
    id: agent.id,
    userId: agent.userId,
    userName: agent.user?.name || null,
    displayName: agent.user?.displayName || agent.name,
    name: agent.name,
    symbol: agent.symbol,
    personality: agent.personality,
    investmentStyle: agent.investmentStyle,
    riskPreference: agent.riskPreference,
    model: agent.model,
    promptVersion: agent.promptVersion,
    status: agent.status,
    decisionIntervalSeconds: agent.decisionIntervalSeconds,
    cooldownSeconds: agent.cooldownSeconds,
    lastDecisionAt: agent.lastDecisionAt?.toISOString() || null,
    nextDecisionAt: agent.nextDecisionAt?.toISOString() || null,
    lastTradeAt: agent.lastTradeAt?.toISOString() || null,
    cooldownUntil: agent.cooldownUntil?.toISOString() || null,
    totalDecisions: agent.totalDecisions,
    totalTrades: agent.totalTrades,
    totalPnl: mark.totalPnl,
    totalPnlPct: mark.totalPnlPct,
    totalEquity: mark.totalEquity,
    realizedPnl: mark.realizedPnl,
    unrealizedPnl: mark.unrealizedPnl,
    openPositions: mark.openPositions,
    netExposure: mark.netExposure,
    score: agent.score,
    createdAt: agent.createdAt?.toISOString(),
    lastDecision: lastDecision ? serializeDecision(lastDecision) : null,
  };
}

function markToMarket(user: any) {
  const prices = marketData.getPrices();
  const cashBalance = parseFloat(user?.account?.cashBalance?.toString() || '100000');
  const totalDeposited = parseFloat(user?.account?.totalDeposited?.toString() || '100000') || 100000;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let netExposure = 0;

  const openPositions = (user?.positions || [])
    .map((p: any) => {
      const size = parseFloat(p.size?.toString() || '0');
      const avgCost = parseFloat(p.avgCost?.toString() || '0');
      const realizedPnl = parseFloat(p.realizedPnl?.toString() || '0');
      const currentPrice = prices[p.symbol] || avgCost;
      const positionUnrealizedPnl = (currentPrice - avgCost) * size;
      const notional = Math.abs(size * currentPrice);
      return {
        symbol: p.symbol,
        size,
        avgCost,
        currentPrice,
        realizedPnl,
        unrealizedPnl: positionUnrealizedPnl,
        unrealizedPnlPct: avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * (size >= 0 ? 100 : -100) : 0,
        direction: size >= 0 ? 'long' : 'short',
        notional,
      };
    })
    .filter((p: any) => Math.abs(p.size) > 0);

  for (const position of openPositions) {
    realizedPnl += position.realizedPnl;
    unrealizedPnl += position.unrealizedPnl;
    netExposure += position.notional;
  }

  const totalEquity = cashBalance + unrealizedPnl;
  const totalPnl = totalEquity - totalDeposited;
  const totalPnlPct = totalDeposited > 0 ? (totalPnl / totalDeposited) * 100 : 0;

  return {
    cashBalance,
    totalDeposited,
    totalEquity,
    totalPnl,
    totalPnlPct,
    realizedPnl,
    unrealizedPnl,
    netExposure,
    openPositions,
  };
}

function serializeDecision(decision: any) {
  return {
    id: decision.id,
    agentId: decision.agentId,
    userId: decision.userId,
    symbol: decision.symbol,
    action: decision.action,
    side: decision.side,
    confidence: decision.confidence,
    sizePct: decision.sizePct,
    riskLevel: decision.riskLevel,
    reasonSummary: decision.reasonSummary,
    langfuseTraceId: decision.langfuseTraceId,
    status: decision.status,
    rejectReason: decision.rejectReason,
    orderId: decision.orderId,
    intendedSize: decision.intendedSize ? parseFloat(decision.intendedSize.toString()) : null,
    fillPrice: decision.fillPrice ? parseFloat(decision.fillPrice.toString()) : null,
    realizedPnl: decision.realizedPnl ? parseFloat(decision.realizedPnl.toString()) : null,
    createdAt: decision.createdAt?.toISOString(),
    executedAt: decision.executedAt?.toISOString() || null,
    marketSnapshot: decision.marketSnapshot ? serializeSnapshot(decision.marketSnapshot) : null,
    riskChecks: decision.riskChecks?.map((r: any) => ({
      name: r.name,
      passed: r.passed,
      message: r.message,
      createdAt: r.createdAt?.toISOString(),
    })) || [],
    toolCalls: decision.toolCalls?.map((t: any) => ({
      id: t.id,
      step: t.step,
      toolName: t.toolName,
      input: t.input,
      output: t.output,
      latencyMs: t.latencyMs,
      createdAt: t.createdAt?.toISOString(),
    })) || [],
  };
}

function serializeSnapshot(s: any) {
  return {
    symbol: s.symbol,
    price: parseFloat(s.price.toString()),
    positionSize: parseFloat(s.positionSize.toString()),
    positionAvgCost: parseFloat(s.positionAvgCost.toString()),
    cashBalance: parseFloat(s.cashBalance.toString()),
    totalEquity: parseFloat(s.totalEquity.toString()),
    ema20: s.ema20 ? parseFloat(s.ema20.toString()) : null,
    ema60: s.ema60 ? parseFloat(s.ema60.toString()) : null,
    rsi14: s.rsi14 ? parseFloat(s.rsi14.toString()) : null,
    atr14: s.atr14 ? parseFloat(s.atr14.toString()) : null,
    priceChangePct: s.priceChangePct ? parseFloat(s.priceChangePct.toString()) : null,
    trendScore: s.trendScore,
    volatilityScore: s.volatilityScore,
    createdAt: s.createdAt?.toISOString(),
  };
}

function buildAgentPerformance(agents: any[], decisions: any[]) {
  const byAgent = new Map<string, any[]>();
  for (const decision of decisions) {
    if (!byAgent.has(decision.agentId)) byAgent.set(decision.agentId, []);
    byAgent.get(decision.agentId)!.push(decision);
  }

  const profiles = agents.map((agent) => {
    const rows = byAgent.get(agent.id) || [];
    const initialEquity = parseFloat(agent.user?.account?.totalDeposited?.toString() || '100000') || 100000;
    let peakEquity = initialEquity;
    let maxDrawdownPct = 0;
    let executed = 0;
    let closedSamples = 0;
    let wins = 0;
    let realizedPnl = 0;

    const rawCurve = rows
      .filter((d) => d.marketSnapshot)
      .map((d) => {
        const equity = parseFloat(d.marketSnapshot.totalEquity.toString());
        peakEquity = Math.max(peakEquity, equity);
        const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
        if (d.status === 'executed') executed++;
        const pnl = d.realizedPnl ? parseFloat(d.realizedPnl.toString()) : 0;
        const positionSize = d.marketSnapshot ? parseFloat(d.marketSnapshot.positionSize.toString()) : 0;
        const closedPosition = d.action === 'close'
          || d.action === 'reduce'
          || (d.action === 'buy' && positionSize < 0)
          || (d.action === 'sell' && positionSize > 0);
        if (closedPosition) {
          closedSamples++;
          realizedPnl += pnl;
          if (pnl > 0) wins++;
        }
        return {
          at: d.createdAt.toISOString(),
          equity,
          pnl,
          pnlPct: initialEquity > 0 ? ((equity - initialEquity) / initialEquity) * 100 : 0,
          action: d.action,
          symbol: d.symbol,
          confidence: d.confidence,
        };
      });

    const sampleSize = rows.length;
    const tradeCount = agent.totalTrades || executed;
    const mark = markToMarket(agent.user);
    const winRate = closedSamples > 0 ? wins / closedSamples : null;
    peakEquity = Math.max(peakEquity, mark.totalEquity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peakEquity > 0 ? ((peakEquity - mark.totalEquity) / peakEquity) * 100 : 0);
    const curve = downsampleCurve([
      ...rawCurve,
      {
        at: new Date().toISOString(),
        equity: mark.totalEquity,
        pnl: mark.totalPnl,
        pnlPct: mark.totalPnlPct,
        action: 'mark',
        symbol: agent.symbol,
        confidence: rows[rows.length - 1]?.confidence || 0,
      },
    ], 80);
    const winRateScore = winRate ?? 0;
    const performanceScore = mark.totalPnlPct * 3 + winRateScore * 25 + Math.min(tradeCount, 50) * 0.25 - maxDrawdownPct * 1.2 + Math.min(sampleSize, 100) * 0.05;
    const riskScore = (1 - winRateScore) * 15 + Math.min(tradeCount, 50) * 0.2 + maxDrawdownPct * 0.8 + Math.min(sampleSize, 100) * 0.03;

    return {
      agentId: agent.id,
      name: agent.name,
      displayName: agent.user?.displayName || agent.name,
      symbol: agent.symbol,
      personality: agent.personality,
      investmentStyle: agent.investmentStyle,
      riskPreference: agent.riskPreference,
      initialEquity,
      lastEquity: mark.totalEquity,
      pnl: mark.totalPnl,
      pnlPct: mark.totalPnlPct,
      realizedPnl: mark.realizedPnl,
      unrealizedPnl: mark.unrealizedPnl,
      totalTrades: tradeCount,
      closedSamples,
      openPositions: mark.openPositions,
      netExposure: mark.netExposure,
      decisions: sampleSize,
      winRate,
      maxDrawdownPct,
      performanceScore,
      riskScore,
      curve,
    };
  });

  const rankedProfiles = profiles
    .slice()
    .sort((a, b) => b.performanceScore - a.performanceScore);

  return {
    profiles,
    rankedProfiles: rankedProfiles.slice(0, 16),
  };
}

function downsampleCurve<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  const sampled: T[] = [];
  for (let i = 0; i < limit; i++) sampled.push(items[Math.round(i * step)]);
  return sampled;
}

export default async function aiAgentRoutes(fastify: FastifyInstance) {
  fastify.get('/ai-agents', async (request, reply) => {
    const { status, symbol, limit = '100' } = request.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (symbol) where.symbol = String(symbol).toUpperCase();
    const take = Math.min(parseInt(limit, 10) || 100, 1000);

    const agents = await fastify.prisma.aiAgent.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            displayName: true,
            account: { select: { cashBalance: true, totalDeposited: true } },
            positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
          },
        },
        decisions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { marketSnapshot: true, riskChecks: true },
        },
      },
      orderBy: [{ status: 'asc' }, { nextDecisionAt: 'asc' }],
      take,
    });

    return reply.send({ data: agents.map(serializeAgent) });
  });

  fastify.get('/ai-agents/overview', async (_request, reply) => {
    const [total, active, decisions, executed, rejected] = await Promise.all([
      fastify.prisma.aiAgent.count(),
      fastify.prisma.aiAgent.count({ where: { status: 'active' } }),
      fastify.prisma.aiDecision.count(),
      fastify.prisma.aiDecision.count({ where: { status: 'executed' } }),
      fastify.prisma.aiDecision.count({ where: { status: 'rejected' } }),
    ]);

    const top = await fastify.prisma.aiAgent.findMany({
      take: 10,
      orderBy: { totalPnl: 'desc' },
      include: {
        user: {
          select: {
            name: true,
            displayName: true,
            account: { select: { cashBalance: true, totalDeposited: true } },
            positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
          },
        },
      },
    });

    return reply.send({
      total,
      active,
      decisions,
      executed,
      rejected,
      top: top.map(serializeAgent),
    });
  });

  fastify.get('/ai-agents/fleet', async (_request, reply) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const performanceSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [agents, recentDecisions, performanceDecisions] = await Promise.all([
      fastify.prisma.aiAgent.findMany({
        include: {
          user: {
            select: {
              name: true,
              displayName: true,
              account: { select: { cashBalance: true, totalDeposited: true } },
              positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
            },
          },
          decisions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { marketSnapshot: true, riskChecks: true, toolCalls: { orderBy: { step: 'asc' } } },
          },
        },
        orderBy: [{ status: 'asc' }, { nextDecisionAt: 'asc' }],
        take: 1000,
      }),
      fastify.prisma.aiDecision.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          agent: { select: { name: true, personality: true, investmentStyle: true, riskPreference: true } },
          marketSnapshot: true,
          toolCalls: { orderBy: { step: 'asc' } },
        },
      }),
      fastify.prisma.aiDecision.findMany({
        where: { createdAt: { gte: performanceSince } },
        orderBy: { createdAt: 'asc' },
        take: 2500,
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              personality: true,
              investmentStyle: true,
              riskPreference: true,
              symbol: true,
              totalPnl: true,
              totalTrades: true,
              user: {
                select: {
                  displayName: true,
                  account: { select: { cashBalance: true, totalDeposited: true } },
                  positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
                },
              },
            },
          },
          marketSnapshot: true,
        },
      }),
    ]);

    const byAction: Record<string, number> = {};
    const bySymbol: Record<string, { total: number; buy: number; sell: number; hold: number; close: number; confidence: number }> = {};
    const byStyle: Record<string, { total: number; pnl: number; confidence: number }> = {};
    const byPersonality: Record<string, { total: number; pnl: number; confidence: number; buy: number; sell: number }> = {};
    const byRisk: Record<string, number> = {};
    let totalPnl = 0;
    let totalTrades = 0;
    let openPositionCount = 0;
    let netExposure = 0;
    let active = 0;

    for (const agent of agents) {
      if (agent.status === 'active') active++;
      totalTrades += agent.totalTrades;
      const mark = markToMarket(agent.user);
      totalPnl += mark.totalPnl;
      openPositionCount += mark.openPositions.length;
      netExposure += mark.netExposure;
      byRisk[agent.riskPreference] = (byRisk[agent.riskPreference] || 0) + 1;
      const style = byStyle[agent.investmentStyle] || { total: 0, pnl: 0, confidence: 0 };
      style.total++;
      style.pnl += mark.totalPnl;
      const last = agent.decisions?.[0];
      if (last) style.confidence += last.confidence;
      byStyle[agent.investmentStyle] = style;

      const personality = byPersonality[agent.personality] || { total: 0, pnl: 0, confidence: 0, buy: 0, sell: 0 };
      personality.total++;
      personality.pnl += mark.totalPnl;
      if (last) {
        personality.confidence += last.confidence;
        if (last.action === 'buy' || last.action === 'increase') personality.buy++;
        if (last.action === 'sell' || last.action === 'close' || last.action === 'reduce') personality.sell++;
      }
      byPersonality[agent.personality] = personality;
    }

    for (const d of recentDecisions) {
      byAction[d.action] = (byAction[d.action] || 0) + 1;
      const sym = bySymbol[d.symbol] || { total: 0, buy: 0, sell: 0, hold: 0, close: 0, confidence: 0 };
      sym.total++;
      if (d.action === 'buy' || d.action === 'increase') sym.buy++;
      else if (d.action === 'sell') sym.sell++;
      else if (d.action === 'close' || d.action === 'reduce') sym.close++;
      else sym.hold++;
      sym.confidence += d.confidence;
      bySymbol[d.symbol] = sym;
    }

    const symbols = Object.entries(bySymbol).map(([symbol, s]) => ({
      symbol,
      total: s.total,
      buy: s.buy,
      sell: s.sell,
      hold: s.hold,
      close: s.close,
      avgConfidence: s.total ? s.confidence / s.total : 0,
      netBias: s.total ? (s.buy - s.sell - s.close * 0.5) / s.total : 0,
    })).sort((a, b) => b.total - a.total);

    const styles = Object.entries(byStyle).map(([style, s]) => ({
      style,
      total: s.total,
      pnl: s.pnl,
      avgConfidence: s.total ? s.confidence / s.total : 0,
    })).sort((a, b) => b.total - a.total);

    const personalities = Object.entries(byPersonality).map(([personality, p]) => ({
      personality,
      total: p.total,
      pnl: p.pnl,
      avgConfidence: p.total ? p.confidence / p.total : 0,
      buy: p.buy,
      sell: p.sell,
      netBias: p.total ? (p.buy - p.sell) / p.total : 0,
    })).sort((a, b) => b.total - a.total);

    const latest = recentDecisions.slice(0, 30).map((d: any) => ({
      ...serializeDecision(d),
      agentName: d.agent?.name,
      personality: d.agent?.personality,
      investmentStyle: d.agent?.investmentStyle,
      riskPreference: d.agent?.riskPreference,
    }));
    const performance = buildAgentPerformance(agents, performanceDecisions);

    return reply.send({
      summary: {
        total: agents.length,
        active,
        paused: agents.filter((a) => a.status === 'paused').length,
        stopped: agents.filter((a) => a.status === 'stopped').length,
        totalPnl,
        totalTrades,
        openPositions: openPositionCount,
        netExposure,
        decisions24h: recentDecisions.length,
        executed24h: recentDecisions.filter((d) => d.status === 'executed').length,
        rejected24h: recentDecisions.filter((d) => d.status === 'rejected').length,
        held24h: recentDecisions.filter((d) => d.status === 'held').length,
      },
      actionMix: byAction,
      symbols,
      styles,
      personalities,
      riskMix: byRisk,
      performance,
      latest,
      agents: agents.map(serializeAgent),
    });
  });

  fastify.get('/ai-agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await fastify.prisma.aiAgent.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            name: true,
            displayName: true,
            account: { select: { cashBalance: true, totalDeposited: true } },
            positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
          },
        },
        decisions: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { marketSnapshot: true, riskChecks: true, toolCalls: { orderBy: { step: 'asc' } } },
        },
        scores: { orderBy: { day: 'desc' }, take: 30 },
      },
    });
    if (!agent) return reply.status(404).send({ error: 'AI agent not found' });
    return reply.send({
      ...serializeAgent(agent),
      decisions: agent.decisions.map(serializeDecision),
      scores: agent.scores.map((s: any) => ({
        day: s.day.toISOString(),
        decisions: s.decisions,
        trades: s.trades,
        winCount: s.winCount,
        pnl: parseFloat(s.pnl.toString()),
        score: s.score,
        stableWinner: s.stableWinner,
        stableLoser: s.stableLoser,
      })),
    });
  });

  fastify.post('/ai-agents', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const agent = await createAiTrader(fastify, request.authUser!.id, parsed.data);
    return reply.status(201).send(serializeAgent(agent));
  });

  fastify.post('/ai-agents/bulk', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = bulkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const created = [];
    for (let i = 0; i < parsed.data.count; i++) {
      const profile = randomProfile(i, parsed.data);
      const agent = await createAiTrader(fastify, request.authUser!.id, profile);
      created.push(serializeAgent(agent));
    }

    return reply.status(201).send({ data: created, count: created.length });
  });

  fastify.patch('/ai-agents/:id/status', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status?: 'active' | 'paused' | 'stopped' };
    if (!status || !['active', 'paused', 'stopped'].includes(status)) {
      return reply.status(400).send({ error: 'status must be active, paused, or stopped' });
    }

    const agent = await fastify.prisma.aiAgent.update({
      where: { id },
      data: {
        status,
        nextDecisionAt: status === 'active' ? randomInitialDecisionTime(1800) : null,
      },
      include: {
        user: {
          select: {
            name: true,
            displayName: true,
            account: { select: { cashBalance: true, totalDeposited: true } },
            positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
          },
        },
        decisions: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    return reply.send(serializeAgent(agent));
  });

  fastify.post('/ai-agents/:id/run-now', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await fastify.prisma.aiAgent.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, displayName: true } } },
    });
    if (!agent) return reply.status(404).send({ error: 'AI agent not found' });
    await processAiAgent(fastify.prisma, fastify.io, agent as any);
    const latest = await fastify.prisma.aiDecision.findFirst({
      where: { agentId: id },
      orderBy: { createdAt: 'desc' },
      include: { marketSnapshot: true, riskChecks: true, toolCalls: { orderBy: { step: 'asc' } } },
    });
    return reply.send({ decision: latest ? serializeDecision(latest) : null });
  });
}

async function createAiTrader(fastify: FastifyInstance, ownerId: string, input: z.infer<typeof createSchema>) {
  const name = normalizeName(input.name || `${input.investmentStyle}_${input.symbol}_${crypto.randomBytes(3).toString('hex')}`);
  const uniqueName = await uniqueUserName(fastify, name);
  const initialBalance = input.initialBalance || 100000;
  const apiKey = `at_sk_${crypto.randomBytes(24).toString('hex')}`;
  const claimToken = `at_claim_${crypto.randomBytes(24).toString('hex')}`;

  const user = await fastify.prisma.user.create({
    data: {
      type: 'agent',
      name: uniqueName,
      displayName: input.name || uniqueName,
      description: `${input.personality} ${input.investmentStyle} AI trader for ${input.symbol}`,
      aiModel: input.model || DEFAULT_AI_MODEL,
      apiKey,
      claimToken,
      claimStatus: 'claimed',
      emailVerified: true,
      ownerId,
      account: { create: { cashBalance: new Prisma.Decimal(initialBalance), totalDeposited: new Prisma.Decimal(initialBalance) } },
      positions: {
        createMany: {
          data: ALL_SYMBOLS.map((symbol) => ({ symbol, size: 0, avgCost: 0 })),
        },
      },
    },
  });

  if (matchxEnabled()) {
    await createMatchxAccountForUser(fastify.prisma, user.id);
  }

  return fastify.prisma.aiAgent.create({
    data: {
      userId: user.id,
      name: input.name || uniqueName,
      symbol: input.symbol,
      personality: input.personality,
      investmentStyle: input.investmentStyle,
      riskPreference: input.riskPreference,
      model: input.model || DEFAULT_AI_MODEL,
      promptVersion: input.promptVersion || 'ai-trader-v1',
      decisionIntervalSeconds: input.decisionIntervalSeconds || 1800,
      cooldownSeconds: input.cooldownSeconds || 1800,
      nextDecisionAt: randomInitialDecisionTime(input.decisionIntervalSeconds || 1800),
    },
    include: {
      user: {
        select: {
          name: true,
          displayName: true,
          account: { select: { cashBalance: true, totalDeposited: true } },
          positions: { select: { symbol: true, size: true, avgCost: true, realizedPnl: true } },
        },
      },
      decisions: { take: 1, orderBy: { createdAt: 'desc' }, include: { marketSnapshot: true, riskChecks: true } },
    },
  });
}

function randomProfile(i: number, input: z.infer<typeof bulkSchema>): z.infer<typeof createSchema> {
  const symbols = input.symbols || [...ALL_SYMBOLS];
  const symbol = symbols[i % symbols.length];
  const personality = PERSONALITIES[i % PERSONALITIES.length];
  const investmentStyle = STYLES[Math.floor(i / PERSONALITIES.length) % STYLES.length];
  const riskPreference = RISK[Math.floor(i / (PERSONALITIES.length * STYLES.length)) % RISK.length];
  return {
    name: `ai_${investmentStyle}_${personality}_${symbol.toLowerCase()}_${String(i + 1).padStart(4, '0')}`,
    symbol,
    personality,
    investmentStyle,
    riskPreference,
    model: DEFAULT_AI_MODEL,
    decisionIntervalSeconds: input.decisionIntervalSeconds || 1800,
    cooldownSeconds: input.cooldownSeconds || 1800,
    initialBalance: input.initialBalance || 100000,
  };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `ai_${crypto.randomBytes(4).toString('hex')}`;
}

async function uniqueUserName(fastify: FastifyInstance, baseName: string): Promise<string> {
  let candidate = baseName.slice(0, 30);
  for (let i = 0; i < 50; i++) {
    const exists = await fastify.prisma.user.findUnique({ where: { name: candidate } });
    if (!exists) return candidate;
    candidate = `${baseName.slice(0, 24)}_${crypto.randomBytes(3).toString('hex')}`;
  }
  return `ai_${crypto.randomBytes(10).toString('hex')}`;
}
