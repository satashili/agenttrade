import { Prisma, PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

import { ALL_SYMBOLS } from '@agenttrade/types';
import { marketData } from './binanceFeed.js';
import { executeMatchxOrder } from './matchxTrading.js';
import { fetchKlines } from './marketKlines.js';
import { ema, rsi, atr, priceChangePct } from './indicators.js';
import { finishAiDecisionTrace, recordAiToolCallTrace, startAiDecisionTrace, type AiTraceHandle } from './langfuseTracing.js';
import { llmDecisionConfigured, requestLlmDecision, resolveTradingModel } from './aiLlmDecision.js';

const DECISION_INTERVAL_SECONDS = 1800;
const MAX_DUE_AGENTS_PER_TICK = 50;
const MIN_CONFIDENCE_TO_TRADE = 0.56;

type AiAction = 'hold' | 'buy' | 'sell' | 'close' | 'reduce' | 'increase';
type PositionSide = 'none' | 'long' | 'short';

interface MarketState {
  symbol: string;
  price: number;
  positionSize: number;
  positionAvgCost: number;
  cashBalance: number;
  totalEquity: number;
  ema20: number;
  ema60: number;
  rsi14: number;
  atr14: number;
  priceChangePct: number;
  trendScore: number;
  volatilityScore: number;
}

interface AiDecisionDraft {
  action: AiAction;
  side: PositionSide;
  confidence: number;
  sizePct: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasonSummary: string;
}

interface RiskCheck {
  name: string;
  passed: boolean;
  message?: string;
}

interface AiToolCallRecord {
  step: number;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  latencyMs: number;
}

interface AgentContext {
  state: MarketState;
  candles: Array<{ high: number; low: number; close: number }>;
  closes: number[];
  marketStats: Record<string, unknown>;
  orderBook: Record<string, unknown>;
  portfolio: Record<string, unknown>;
  recentPerformance: Record<string, unknown>;
  toolCalls: AiToolCallRecord[];
}

export async function processDueAiAgents(prisma: PrismaClient, io: SocketServer): Promise<number> {
  const now = new Date();
  const dueAgents = await prisma.aiAgent.findMany({
    where: {
      status: 'active',
      OR: [
        { nextDecisionAt: null },
        { nextDecisionAt: { lte: now } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, displayName: true } },
    },
    orderBy: [{ nextDecisionAt: 'asc' }, { createdAt: 'asc' }],
    take: MAX_DUE_AGENTS_PER_TICK,
  });

  let processed = 0;
  for (const agent of dueAgents) {
    const claimed = await claimAgentDecisionSlot(prisma, agent.id);
    if (!claimed) continue;

    try {
      await processAiAgent(prisma, io, agent as any);
      processed++;
    } catch (err: any) {
      console.error(`[AiTrading] Agent ${agent.id} failed:`, err.message);
      await prisma.aiAgent.update({
        where: { id: agent.id },
        data: {
          lastDecisionAt: now,
          nextDecisionAt: nextDecisionTime(now, agent.decisionIntervalSeconds),
        },
      }).catch(() => {});
    }
  }

  return processed;
}

async function claimAgentDecisionSlot(prisma: PrismaClient, agentId: string): Promise<boolean> {
  const now = new Date();
  const result = await prisma.aiAgent.updateMany({
    where: {
      id: agentId,
      status: 'active',
      OR: [
        { nextDecisionAt: null },
        { nextDecisionAt: { lte: now } },
      ],
    },
    data: {
      nextDecisionAt: new Date(now.getTime() + 60_000),
    },
  });
  return result.count === 1;
}

export async function processAiAgent(prisma: PrismaClient, io: SocketServer, agent: any) {
  const now = new Date();
  const seedState = await buildMarketState(prisma, agent.userId, agent.symbol);
  if (!seedState || seedState.price <= 0) {
    await prisma.aiAgent.update({
      where: { id: agent.id },
      data: {
        lastDecisionAt: now,
        nextDecisionAt: nextDecisionTime(now, agent.decisionIntervalSeconds),
      },
    });
    return;
  }

  const traceId = createTraceId(agent.id, now);
  const seedPrompt = buildDecisionPrompt(agent, seedState, []);
  const trace = startAiDecisionTrace({
    traceId,
    agent: {
      id: agent.id,
      userId: agent.userId,
      name: agent.name,
      symbol: agent.symbol,
      personality: agent.personality,
      investmentStyle: agent.investmentStyle,
      riskPreference: agent.riskPreference,
      model: resolveTradingModel(agent.model),
      promptVersion: agent.promptVersion,
    },
    state: serializeMarketState(seedState),
    prompt: seedPrompt,
  });

  const context = await runAgentToolLoop(prisma, agent, seedState, trace);
  const state = context.state;
  const prompt = buildDecisionPrompt(agent, state, context.toolCalls);
  const draft = await decide(agent, context, prompt, now);
  const decision = await prisma.aiDecision.create({
    data: {
      agentId: agent.id,
      userId: agent.userId,
      symbol: agent.symbol,
      action: draft.action,
      side: draft.side,
      confidence: draft.confidence,
      sizePct: draft.sizePct,
      riskLevel: draft.riskLevel,
      reasonSummary: draft.reasonSummary,
      langfuseTraceId: trace.traceId,
      marketSnapshot: {
        create: {
          symbol: state.symbol,
          price: new Prisma.Decimal(state.price),
          positionSize: new Prisma.Decimal(state.positionSize),
          positionAvgCost: new Prisma.Decimal(state.positionAvgCost),
          cashBalance: new Prisma.Decimal(state.cashBalance),
          totalEquity: new Prisma.Decimal(state.totalEquity),
          ema20: new Prisma.Decimal(state.ema20),
          ema60: new Prisma.Decimal(state.ema60),
          rsi14: new Prisma.Decimal(state.rsi14),
          atr14: new Prisma.Decimal(state.atr14),
          priceChangePct: new Prisma.Decimal(state.priceChangePct),
          trendScore: state.trendScore,
          volatilityScore: state.volatilityScore,
        },
      },
    },
  });

  if (context.toolCalls.length > 0) {
    await prisma.aiToolCall.createMany({
      data: context.toolCalls.map((tool) => ({
        decisionId: decision.id,
        agentId: agent.id,
        step: tool.step,
        toolName: tool.toolName,
        input: tool.input as Prisma.InputJsonValue,
        output: tool.output as Prisma.InputJsonValue,
        latencyMs: tool.latencyMs,
      })),
    });
  }

  const orderPlan = buildOrderPlan(draft, state);
  const riskChecks = runRiskChecks(agent, draft, state, orderPlan, now);
  await prisma.aiRiskCheck.createMany({
    data: riskChecks.map((check) => ({
      decisionId: decision.id,
      name: check.name,
      passed: check.passed,
      message: check.message || null,
    })),
  });

  const failedCheck = riskChecks.find((check) => !check.passed);
  if (draft.action === 'hold' || !orderPlan) {
    await finishDecision(prisma, agent, decision.id, 'held', now);
    await finishAiDecisionTrace(trace, {
      decision: serializeDecisionDraft(draft),
      toolCalls: context.toolCalls.map(serializeToolCall),
      riskChecks: serializeRiskChecks(riskChecks),
      order: null,
      status: 'held',
      pnl: null,
    });
    return;
  }

  if (failedCheck) {
    await finishDecision(prisma, agent, decision.id, 'rejected', now, failedCheck.message || failedCheck.name);
    await finishAiDecisionTrace(trace, {
      decision: serializeDecisionDraft(draft),
      toolCalls: context.toolCalls.map(serializeToolCall),
      riskChecks: serializeRiskChecks(riskChecks),
      order: orderPlan,
      status: 'rejected',
      pnl: null,
      error: failedCheck.message || failedCheck.name,
    });
    return;
  }

  const result = await executeMatchxOrder(prisma, {
    userId: agent.userId,
    agentName: agent.user.displayName || agent.user.name,
    symbol: agent.symbol,
    side: orderPlan.side,
    type: 'market',
    size: orderPlan.size,
    io,
  });

  if (!result.success) {
    await finishDecision(prisma, agent, decision.id, 'failed', now, result.error || 'order_failed', orderPlan.size);
    await finishAiDecisionTrace(trace, {
      decision: serializeDecisionDraft(draft),
      toolCalls: context.toolCalls.map(serializeToolCall),
      riskChecks: serializeRiskChecks(riskChecks),
      order: orderPlan,
      status: 'failed',
      pnl: null,
      error: result.error || 'order_failed',
    });
    return;
  }

  const order = result.data?.order;
  await prisma.aiDecision.update({
    where: { id: decision.id },
    data: {
      status: 'executed',
      orderId: result.orderId || null,
      intendedSize: new Prisma.Decimal(orderPlan.size),
      fillPrice: order?.fillPrice ? new Prisma.Decimal(order.fillPrice) : null,
      realizedPnl: result.pnl != null ? new Prisma.Decimal(result.pnl) : null,
      executedAt: now,
    },
  });

  await prisma.aiAgent.update({
    where: { id: agent.id },
    data: {
      lastDecisionAt: now,
      lastTradeAt: now,
      cooldownUntil: new Date(now.getTime() + agent.cooldownSeconds * 1000),
      nextDecisionAt: nextDecisionTime(now, agent.decisionIntervalSeconds),
      totalDecisions: { increment: 1 },
      totalTrades: { increment: 1 },
      totalPnl: result.pnl != null ? { increment: new Prisma.Decimal(result.pnl) } : undefined,
    },
  });

  await upsertDailyScore(prisma, agent.id, result.pnl || 0, true);
  await finishAiDecisionTrace(trace, {
    decision: serializeDecisionDraft(draft),
    toolCalls: context.toolCalls.map(serializeToolCall),
    riskChecks: serializeRiskChecks(riskChecks),
    order: {
      ...orderPlan,
      orderId: result.orderId || null,
      fillPrice: order?.fillPrice || null,
      fillValue: order?.fillValue || null,
      fee: order?.fee || null,
    },
    status: 'executed',
    pnl: result.pnl || 0,
  });
}

async function finishDecision(
  prisma: PrismaClient,
  agent: any,
  decisionId: string,
  status: 'held' | 'rejected' | 'failed',
  now: Date,
  rejectReason?: string,
  intendedSize?: number
) {
  await prisma.aiDecision.update({
    where: { id: decisionId },
    data: {
      status,
      rejectReason: rejectReason || null,
      intendedSize: intendedSize != null ? new Prisma.Decimal(intendedSize) : undefined,
    },
  });
  await prisma.aiAgent.update({
    where: { id: agent.id },
    data: {
      lastDecisionAt: now,
      nextDecisionAt: nextDecisionTime(now, agent.decisionIntervalSeconds),
      totalDecisions: { increment: 1 },
    },
  });
  await upsertDailyScore(prisma, agent.id, 0, false);
}

async function buildMarketState(prisma: PrismaClient, userId: string, symbol: string): Promise<MarketState | null> {
  const prices = marketData.getPrices();
  const price = prices[symbol];
  if (!price) return null;

  const [{ closes, candles }, account, position] = await Promise.all([
    fetchKlines(symbol, '30m', 120),
    prisma.account.findUnique({ where: { userId } }),
    prisma.position.findUnique({ where: { userId_symbol: { userId, symbol } } }),
  ]);

  const allCloses = [...closes, price].filter((n) => Number.isFinite(n) && n > 0);
  const ema20 = ema(allCloses, 20);
  const ema60 = ema(allCloses, 60);
  const rsi14 = rsi(allCloses, 14);
  const atr14 = atr(candles, 14);
  const changePct = priceChangePct(allCloses, 6);
  const positionSize = position ? parseFloat(position.size.toString()) : 0;
  const positionAvgCost = position ? parseFloat(position.avgCost.toString()) : 0;
  const cashBalance = account ? parseFloat(account.cashBalance.toString()) : 0;
  const totalEquity = Math.max(0, cashBalance + positionSize * price);
  const trendScore = ema60 > 0 ? clamp((ema20 - ema60) / ema60, -0.05, 0.05) / 0.05 : 0;
  const volatilityScore = price > 0 ? clamp(atr14 / price, 0, 0.08) / 0.08 : 0;

  return {
    symbol,
    price,
    positionSize,
    positionAvgCost,
    cashBalance,
    totalEquity,
    ema20,
    ema60,
    rsi14,
    atr14,
    priceChangePct: changePct,
    trendScore,
    volatilityScore,
  };
}

async function runAgentToolLoop(
  prisma: PrismaClient,
  agent: any,
  seedState: MarketState,
  trace: AiTraceHandle
): Promise<AgentContext> {
  const calls: AiToolCallRecord[] = [];
  let step = 1;

  const record = async (
    toolName: string,
    input: Record<string, unknown>,
    fn: () => Promise<Record<string, unknown>>
  ): Promise<Record<string, unknown>> => {
    const started = Date.now();
    let output: Record<string, unknown>;
    try {
      output = await fn();
    } catch (err: any) {
      output = { error: err?.message || 'tool_failed' };
    }
    const toolCall = {
      step: step++,
      toolName,
      input,
      output,
      latencyMs: Date.now() - started,
    };
    calls.push(toolCall);
    recordAiToolCallTrace(trace, {
      name: toolName,
      input,
      output,
      latencyMs: toolCall.latencyMs,
      step: toolCall.step,
    });
    return output;
  };

  const marketStats = await record('get_market_stats', { symbol: agent.symbol }, async () => {
    const stats = marketData.getStats()[agent.symbol] || {};
    return {
      ...stats,
      symbol: agent.symbol,
      price: seedState.price,
    };
  });

  const klineOutput = await record('get_klines_and_indicators', { symbol: agent.symbol, interval: '30m', limit: 120 }, async () => {
    const { closes, candles } = await fetchKlines(agent.symbol, '30m', 120);
    const allCloses = [...closes, seedState.price].filter((n) => Number.isFinite(n) && n > 0);
    return {
      closes,
      candles,
      indicators: {
        ema20: ema(allCloses, 20),
        ema60: ema(allCloses, 60),
        rsi14: rsi(allCloses, 14),
        atr14: atr(candles, 14),
        priceChangePct6: priceChangePct(allCloses, 6),
      },
    };
  });

  const orderBook = await record('get_order_book_depth', { symbol: agent.symbol, limit: 20 }, async () => {
    return fetchOrderBook(agent.symbol);
  });

  const portfolio = await record('get_portfolio_state', { userId: agent.userId, symbol: agent.symbol }, async () => {
    const [account, position, orders] = await Promise.all([
      prisma.account.findUnique({ where: { userId: agent.userId } }),
      prisma.position.findUnique({ where: { userId_symbol: { userId: agent.userId, symbol: agent.symbol } } }),
      prisma.order.findMany({
        where: { userId: agent.userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { symbol: true, side: true, size: true, fillPrice: true, status: true, createdAt: true },
      }),
    ]);
    return {
      cashBalance: account ? parseFloat(account.cashBalance.toString()) : 0,
      totalDeposited: account ? parseFloat(account.totalDeposited.toString()) : 0,
      position: position ? {
        symbol: position.symbol,
        size: parseFloat(position.size.toString()),
        avgCost: parseFloat(position.avgCost.toString()),
        realizedPnl: parseFloat(position.realizedPnl.toString()),
      } : null,
      recentOrders: orders.map((o) => ({
        symbol: o.symbol,
        side: o.side,
        size: parseFloat(o.size.toString()),
        fillPrice: o.fillPrice ? parseFloat(o.fillPrice.toString()) : null,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  });

  const recentPerformance = await record('get_agent_recent_performance', { agentId: agent.id, window: 20 }, async () => {
    const decisions = await prisma.aiDecision.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { action: true, status: true, confidence: true, realizedPnl: true, createdAt: true },
    });
    const pnl = decisions.reduce((sum, d) => sum + (d.realizedPnl ? parseFloat(d.realizedPnl.toString()) : 0), 0);
    return {
      decisions: decisions.length,
      executed: decisions.filter((d) => d.status === 'executed').length,
      held: decisions.filter((d) => d.status === 'held').length,
      rejected: decisions.filter((d) => d.status === 'rejected').length,
      pnl,
      avgConfidence: decisions.length
        ? decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length
        : 0,
    };
  });

  const closes = Array.isArray(klineOutput.closes) ? klineOutput.closes as number[] : [];
  const candles = Array.isArray(klineOutput.candles) ? klineOutput.candles as Array<{ high: number; low: number; close: number }> : [];
  return {
    state: seedState,
    closes,
    candles,
    marketStats,
    orderBook,
    portfolio,
    recentPerformance,
    toolCalls: calls,
  };
}

async function fetchOrderBook(symbol: string): Promise<Record<string, unknown>> {
  const pairs: Record<string, string> = {
    BTC: 'BTCUSDT', ETH: 'ETHUSDT',
    TSLA: 'TSLAUSDT', AMZN: 'AMZNUSDT', COIN: 'COINUSDT', MSTR: 'MSTRUSDT',
    INTC: 'INTCUSDT', HOOD: 'HOODUSDT', CRCL: 'CRCLUSDT', PLTR: 'PLTRUSDT',
  };
  const pair = pairs[symbol];
  if (!pair) return { error: 'unsupported_symbol' };
  const base = symbol === 'BTC' || symbol === 'ETH'
    ? 'https://api.binance.com/api/v3'
    : 'https://fapi.binance.com/fapi/v1';
  const res = await fetch(`${base}/depth?symbol=${pair}&limit=20`);
  if (!res.ok) return { error: `depth_fetch_failed_${res.status}` };
  const data = await res.json() as any;
  const bid = data.bids?.[0] ? parseFloat(data.bids[0][0]) : null;
  const ask = data.asks?.[0] ? parseFloat(data.asks[0][0]) : null;
  return {
    bestBid: bid,
    bestAsk: ask,
    spread: bid && ask ? ask - bid : null,
    bidLevels: data.bids?.slice(0, 5).map((b: string[]) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })) || [],
    askLevels: data.asks?.slice(0, 5).map((a: string[]) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) })) || [],
  };
}

async function decide(agent: any, context: AgentContext, prompt: Record<string, unknown>, now: Date): Promise<AiDecisionDraft> {
  if (llmDecisionConfigured()) {
    try {
      const llmDraft = await requestLlmDecision({
        agent: {
          id: agent.id,
          name: agent.name,
          symbol: agent.symbol,
          personality: agent.personality,
          investmentStyle: agent.investmentStyle,
          riskPreference: agent.riskPreference,
          model: agent.model,
          promptVersion: agent.promptVersion,
          decisionIntervalSeconds: agent.decisionIntervalSeconds,
          cooldownSeconds: agent.cooldownSeconds,
        },
        prompt,
        maxSizePct: maxSizePct(agent.riskPreference, agent.personality),
      });
      return {
        ...llmDraft,
        reasonSummary: `LLM ${resolveTradingModel(agent.model)}: ${llmDraft.reasonSummary}`,
      };
    } catch (err: any) {
      console.error(`[AiTrading] LLM decision failed for ${agent.id}, falling back to local rules:`, err?.message || err);
    }
  }

  return decideWithLocalRules(agent, context, now);
}

function decideWithLocalRules(agent: any, context: AgentContext, now: Date): AiDecisionDraft {
  const state = context.state;
  const random = seededRandom(`${agent.id}:${Math.floor(now.getTime() / (30 * 60_000))}`);
  const style = agent.investmentStyle;
  const personality = agent.personality;
  const riskPreference = agent.riskPreference;
  let directionalScore = state.trendScore * 0.55 + clamp(state.priceChangePct / 8, -1, 1) * 0.25;
  const spread = typeof context.orderBook.spread === 'number' ? context.orderBook.spread : 0;
  const spreadPenalty = state.price > 0 ? clamp(spread / state.price, 0, 0.002) * 20 : 0;
  const recentPnl = typeof context.recentPerformance.pnl === 'number' ? context.recentPerformance.pnl : 0;
  if (recentPnl < 0) directionalScore *= 0.85;
  if (style === 'mean_reversion') directionalScore = -directionalScore + (50 - state.rsi14) / 80;
  if (style === 'breakout') directionalScore += Math.sign(state.priceChangePct) * state.volatilityScore * 0.25;
  if (style === 'contrarian') directionalScore = -directionalScore;
  if (style === 'defensive') directionalScore *= 0.65;
  if (personality === 'aggressive') directionalScore += (random - 0.5) * 0.35;
  if (personality === 'patient') directionalScore *= 0.8;
  if (personality === 'chaotic') directionalScore += (random - 0.5) * 0.7;

  const absScore = Math.abs(directionalScore);
  const confidence = clamp(0.48 + absScore * 0.42 + random * 0.14 - spreadPenalty, 0.05, 0.96);
  const maxSize = maxSizePct(riskPreference, personality);
  const sizePct = roundPct(clamp(maxSize * (0.45 + confidence * 0.75), 0.002, maxSize));
  const riskLevel = sizePct <= 0.012 ? 'low' : sizePct <= 0.03 ? 'medium' : 'high';

  const side: PositionSide = directionalScore >= 0 ? 'long' : 'short';
  return {
    action: side === 'long' ? 'buy' : 'sell',
    side,
    confidence: Math.max(confidence, MIN_CONFIDENCE_TO_TRADE),
    sizePct,
    riskLevel,
    reasonSummary: `Fallback forced ${side === 'long' ? 'buy' : 'sell'} because AI decisions are buy/sell only: signal ${absScore.toFixed(2)}, confidence ${confidence.toFixed(2)}, RSI ${state.rsi14.toFixed(1)}, volatility ${state.volatilityScore.toFixed(2)}, ${style}/${personality}.`,
  };
}

function buildOrderPlan(draft: AiDecisionDraft, state: MarketState): { side: 'buy' | 'sell'; size: number } | null {
  if (draft.action === 'hold') return null;
  if (draft.action === 'close') {
    if (state.positionSize > 0) return { side: 'sell', size: roundSize(state.symbol, Math.abs(state.positionSize)) };
    if (state.positionSize < 0) return { side: 'buy', size: roundSize(state.symbol, Math.abs(state.positionSize)) };
    return null;
  }
  if (draft.action === 'reduce') {
    if (state.positionSize > 0) return { side: 'sell', size: roundSize(state.symbol, Math.abs(state.positionSize) * 0.5) };
    if (state.positionSize < 0) return { side: 'buy', size: roundSize(state.symbol, Math.abs(state.positionSize) * 0.5) };
    return null;
  }

  const notional = Math.max(state.totalEquity, state.cashBalance) * draft.sizePct;
  const size = roundSize(state.symbol, notional / state.price);
  if (size <= 0) return null;

  if (draft.action === 'increase') {
    if (draft.side === 'long') return { side: 'buy', size };
    if (draft.side === 'short') return { side: 'sell', size };
    return null;
  }

  return { side: draft.action === 'buy' ? 'buy' : 'sell', size };
}

function runRiskChecks(agent: any, draft: AiDecisionDraft, state: MarketState, orderPlan: { side: 'buy' | 'sell'; size: number } | null, now: Date): RiskCheck[] {
  const checks: RiskCheck[] = [];
  const cooldownUntil = agent.cooldownUntil ? new Date(agent.cooldownUntil) : null;
  checks.push({
    name: 'cooldown',
    passed: !cooldownUntil || cooldownUntil <= now,
    message: cooldownUntil && cooldownUntil > now ? `Cooling down until ${cooldownUntil.toISOString()}` : undefined,
  });
  checks.push({
    name: 'confidence',
    passed: true,
    message: `confidence=${draft.confidence.toFixed(2)}, non_blocking_buy_sell_only`,
  });
  checks.push({
    name: 'equity_positive',
    passed: state.totalEquity > 0 || draft.action === 'close' || draft.action === 'reduce',
    message: `equity=${state.totalEquity.toFixed(2)}`,
  });
  checks.push({
    name: 'symbol_allowed',
    passed: (ALL_SYMBOLS as readonly string[]).includes(state.symbol),
    message: state.symbol,
  });
  checks.push({
    name: 'order_size',
    passed: !orderPlan || orderPlan.size > 0,
    message: orderPlan ? `size=${orderPlan.size}` : 'no order',
  });
  if (orderPlan) {
    const notional = orderPlan.size * state.price;
    const maxNotional = Math.max(state.totalEquity, state.cashBalance) * maxSizePct(agent.riskPreference, agent.personality) * 1.25;
    checks.push({
      name: 'position_cap',
      passed: draft.action === 'close' || draft.action === 'reduce' || notional <= maxNotional,
      message: `notional=${notional.toFixed(2)}, cap=${maxNotional.toFixed(2)}`,
    });
  }
  return checks;
}

async function upsertDailyScore(prisma: PrismaClient, agentId: string, pnl: number, traded: boolean) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const scoreDelta = traded ? pnl / 100 : 0;
  await prisma.$transaction([
    prisma.aiAgentScoreDaily.upsert({
      where: { agentId_day: { agentId, day } },
      create: {
        agentId,
        day,
        decisions: 1,
        trades: traded ? 1 : 0,
        winCount: pnl > 0 ? 1 : 0,
        pnl: new Prisma.Decimal(pnl),
        score: scoreDelta,
        inverseScore: -scoreDelta,
        stableWinner: scoreDelta > 1,
        stableLoser: scoreDelta < -1,
      },
      update: {
        decisions: { increment: 1 },
        trades: traded ? { increment: 1 } : undefined,
        winCount: pnl > 0 ? { increment: 1 } : undefined,
        pnl: { increment: new Prisma.Decimal(pnl) },
        score: { increment: scoreDelta },
        inverseScore: { increment: -scoreDelta },
      },
    }),
    prisma.aiAgent.update({
      where: { id: agentId },
      data: { score: { increment: scoreDelta } },
    }),
  ]);
}

export function randomInitialDecisionTime(intervalSeconds = DECISION_INTERVAL_SECONDS): Date {
  return new Date(Date.now() + Math.floor(Math.random() * intervalSeconds * 1000));
}

function nextDecisionTime(now: Date, intervalSeconds: number): Date {
  return new Date(now.getTime() + Math.max(60, intervalSeconds || DECISION_INTERVAL_SECONDS) * 1000);
}

function maxSizePct(riskPreference: string, personality: string): number {
  const base = riskPreference === 'high' ? 0.05 : riskPreference === 'low' ? 0.012 : 0.025;
  if (personality === 'aggressive') return base * 1.25;
  if (personality === 'patient' || personality === 'defensive') return base * 0.75;
  return base;
}

function roundSize(symbol: string, size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return truncateSize(size, 3);
}

function truncateSize(size: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor(size * factor) / factor;
}

function roundPct(value: number): number {
  return parseFloat(value.toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function seededRandom(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
}

function createTraceId(agentId: string, now: Date): string {
  return `ai_${agentId}_${now.getTime()}`;
}

function buildDecisionPrompt(agent: any, state: MarketState, toolCalls: AiToolCallRecord[]): Record<string, unknown> {
  return {
    task: 'Run a low-frequency multi-step trading analysis using platform tools, then decide one action. Allowed actions: buy or sell only. Never hold.',
    constraints: {
      minimumDecisionIntervalSeconds: agent.decisionIntervalSeconds,
      cooldownSeconds: agent.cooldownSeconds,
      noHighFrequencyTrading: true,
      outputShape: {
        action: 'buy|sell',
        side: 'long|short',
        confidence: '0.0-1.0',
        sizePct: 'fraction of equity',
        riskLevel: 'low|medium|high',
        reasonSummary: 'short auditable rationale',
      },
      noHold: true,
      sizePctMeaning: 'A decimal fraction of account equity to allocate this cycle. Example: 0.01 means 1% of equity.',
    },
    agent: {
      id: agent.id,
      name: agent.name,
      symbol: agent.symbol,
      personality: agent.personality,
      investmentStyle: agent.investmentStyle,
      riskPreference: agent.riskPreference,
      model: agent.model,
      promptVersion: agent.promptVersion,
    },
    marketState: serializeMarketState(state),
    toolPlan: [
      'get_market_stats',
      'get_klines_and_indicators',
      'get_order_book_depth',
      'get_portfolio_state',
      'get_agent_recent_performance',
    ],
    toolResults: toolCalls.map(serializeToolCall),
  };
}

function serializeMarketState(state: MarketState): Record<string, unknown> {
  return {
    symbol: state.symbol,
    price: state.price,
    positionSize: state.positionSize,
    positionAvgCost: state.positionAvgCost,
    cashBalance: state.cashBalance,
    totalEquity: state.totalEquity,
    ema20: state.ema20,
    ema60: state.ema60,
    rsi14: state.rsi14,
    atr14: state.atr14,
    priceChangePct: state.priceChangePct,
    trendScore: state.trendScore,
    volatilityScore: state.volatilityScore,
  };
}

function serializeDecisionDraft(draft: AiDecisionDraft): Record<string, unknown> {
  return {
    action: draft.action,
    side: draft.side,
    confidence: draft.confidence,
    sizePct: draft.sizePct,
    riskLevel: draft.riskLevel,
    reasonSummary: draft.reasonSummary,
  };
}

function serializeRiskChecks(checks: RiskCheck[]): Array<Record<string, unknown>> {
  return checks.map((check) => ({
    name: check.name,
    passed: check.passed,
    message: check.message || null,
  }));
}

function serializeToolCall(tool: AiToolCallRecord): Record<string, unknown> {
  return {
    step: tool.step,
    toolName: tool.toolName,
    input: tool.input,
    output: tool.output,
    latencyMs: tool.latencyMs,
  };
}
