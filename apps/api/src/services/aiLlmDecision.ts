type AiAction = 'buy' | 'sell';
type PositionSide = 'long' | 'short';

export interface LlmDecisionDraft {
  action: AiAction;
  side: PositionSide;
  confidence: number;
  sizePct: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasonSummary: string;
}

export interface LlmDecisionInput {
  agent: {
    id: string;
    name: string;
    symbol: string;
    personality: string;
    investmentStyle: string;
    riskPreference: string;
    model?: string | null;
    promptVersion?: string | null;
    decisionIntervalSeconds: number;
    cooldownSeconds: number;
  };
  prompt: Record<string, unknown>;
  maxSizePct: number;
}

const RISKS = new Set(['low', 'medium', 'high']);

export function llmDecisionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL);
}

export function resolveTradingModel(agentModel?: string | null): string {
  if (agentModel && !agentModel.startsWith('local-')) return agentModel;
  return process.env.AI_LLM_MODEL || 'gpt-5.1-mini';
}

export async function requestLlmDecision(input: LlmDecisionInput): Promise<LlmDecisionDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
  if (!apiKey || !baseUrl) throw new Error('OPENAI_API_KEY or OPENAI_BASE_URL is not configured');

  const model = resolveTradingModel(input.agent.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_LLM_TIMEOUT_MS || '20000'));

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: Number(process.env.AI_LLM_TEMPERATURE || '0.35'),
        max_tokens: Number(process.env.AI_LLM_MAX_TOKENS || '450'),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(input.agent, input.maxSizePct),
          },
          {
            role: 'user',
            content: JSON.stringify(input.prompt),
          },
        ],
      }),
      signal: controller.signal,
    });

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body?.error?.message || body?.message || `LLM request failed with ${res.status}`;
      throw new Error(message);
    }

    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('LLM returned empty content');
    return normalizeDecision(JSON.parse(extractJson(content)), input.maxSizePct);
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt(agent: LlmDecisionInput['agent'], maxSizePct: number): string {
  return [
    'You are an internal AgentTrade low-frequency trading AI. You do not place orders directly.',
    'The backend already called platform tools for market stats, 30m indicators, order book, portfolio, and recent performance.',
    'Make exactly one 30-minute trading decision for this agent and return JSON only.',
    'Do not reveal hidden chain-of-thought. Provide a concise auditable reasonSummary based on tool results.',
    `Agent personality: ${agent.personality}.`,
    `Personality behavior: ${personalityBehavior(agent.personality)}.`,
    `Investment style: ${agent.investmentStyle}.`,
    `Style behavior: ${styleBehavior(agent.investmentStyle)}.`,
    `Risk preference: ${agent.riskPreference}.`,
    `Risk behavior: ${riskBehavior(agent.riskPreference)}.`,
    `Primary symbol: ${agent.symbol}.`,
    `Maximum sizePct allowed before risk checks: ${maxSizePct}. Use a decimal fraction, not percent.`,
    'Allowed actions: buy, sell. Never return hold, close, reduce, or increase.',
    'Allowed sides: long, short.',
    'Rules:',
    '- You must choose buy or sell every decision cycle.',
    '- buy means allocate the returned sizePct to long exposure.',
    '- sell means allocate the returned sizePct to short exposure or reduce existing long exposure through the execution layer.',
    '- If conviction is weak or data is mixed, still choose the slightly better side and use the smallest sensible sizePct.',
    '- confidence must be 0 to 1.',
    'Return this exact JSON shape: {"action":"buy|sell","side":"long|short","confidence":0.0,"sizePct":0.0,"riskLevel":"low|medium|high","reasonSummary":"short reason"}',
  ].join('\n');
}

function personalityBehavior(personality: string): string {
  const map: Record<string, string> = {
    aggressive: 'acts earlier, accepts noisier signals, uses larger size within the risk cap',
    patient: 'requires more confirmation and uses smaller size when signals are mixed',
    defensive: 'prioritizes drawdown control and chooses the smaller side/size when uncertain',
    analytical: 'weights indicators, order book, recent performance, and portfolio state systematically',
    chaotic: 'allows more contrarian or exploratory trades while still respecting size caps',
    buffett_value_oracle: 'patient value allocator; prefers durable trends, avoids noisy reversals, uses modest size unless evidence is unusually strong',
    munger_quality_filter: 'quality-first skeptic; penalizes weak or inconsistent signals, chooses smaller size and demands clean evidence',
    soros_reflexive_macro: 'macro reflexivity trader; reacts to regime shifts, momentum feedback loops, and crowding in either direction',
    dalio_all_weather: 'balanced risk-parity allocator; smooths decisions, avoids concentrated conviction, and sizes conservatively',
    lynch_growth_hunter: 'growth scout; favors relative strength and early acceleration while keeping risk tied to confirmation',
    burry_contrarian_short: 'deep contrarian; comfortable selling overextended strength or buying hated weakness when evidence supports reversal',
    simons_quant_machine: 'statistical signal processor; prioritizes indicator alignment, microstructure, and repeatable edge over narrative',
    druckenmiller_macro_sniper: 'concentrated macro tactician; acts decisively when trend, momentum, and volatility line up',
    wood_disruptive_growth: 'innovation bull; leans into high beta strength and disruptive names, but cuts size when momentum fades',
    ackman_activist_focus: 'concentrated fundamental operator; prefers clear asymmetric setups and avoids small noisy trades',
    tudor_jones_risk_tactician: 'risk-first momentum trader; reacts quickly to invalidation and keeps sizing disciplined',
    ruckenstein_deep_value: 'deep value bargain hunter; favors mean reversion after heavy selling, avoids chasing extended moves',
    livermore_tape_reader: 'price-action tape reader; follows short-term momentum and order-book pressure aggressively',
    graham_margin_safety: 'margin-of-safety conservative; chooses the lower-risk side and smallest size when evidence is mixed',
    icahn_event_driven: 'event-driven fighter; seeks decisive directional pressure and is willing to oppose consensus',
    tepper_distressed_hunter: 'distressed rebound hunter; buys capitulation rebounds and sells relief rallies that lack confirmation',
    trump_deal_maker: 'headline-sensitive deal maker; favors bold directional choices, negotiation-like reversals, and larger size when momentum confirms',
    musk_moonshot_operator: 'visionary high-beta operator; favors explosive upside momentum and tolerates volatility within the cap',
    cathie_innovation_bull: 'innovation-growth optimist; buys strong disruptive momentum, sells only when indicators deteriorate clearly',
    renaissance_stat_arb: 'market-neutral statistical arbitrage mind; chooses the side with the strongest short-horizon statistical edge',
  };
  return map[personality] || 'balanced decision making';
}

function styleBehavior(style: string): string {
  const map: Record<string, string> = {
    trend_following: 'favors buying positive EMA/momentum alignment and selling negative alignment',
    mean_reversion: 'favors buying oversold weakness and selling overbought strength',
    breakout: 'favors the direction of expanding volatility and fresh momentum',
    contrarian: 'leans against crowded short-term moves when indicators are stretched',
    defensive: 'takes the side with lower expected drawdown and smaller size',
  };
  return map[style] || 'balanced style';
}

function riskBehavior(riskPreference: string): string {
  const map: Record<string, string> = {
    low: 'use the lower end of allowed sizePct, especially on mixed signals',
    medium: 'use moderate sizePct when signal quality is acceptable',
    high: 'may use the upper end of allowed sizePct when the signal is clear',
  };
  return map[riskPreference] || 'use moderate sizePct';
}

function normalizeDecision(raw: any, maxSizePct: number): LlmDecisionDraft {
  let action: AiAction = raw?.action === 'sell' || raw?.side === 'short' ? 'sell' : 'buy';
  let side: PositionSide = action === 'sell' ? 'short' : 'long';
  let confidence = clamp(Number(raw?.confidence), 0, 1);
  let sizePct = Number(raw?.sizePct);
  if (!Number.isFinite(sizePct)) sizePct = 0;
  if (sizePct > 1) sizePct = sizePct / 100;
  sizePct = clamp(sizePct, minTradePct(maxSizePct), maxSizePct);
  let riskLevel = RISKS.has(raw?.riskLevel) ? raw.riskLevel as 'low' | 'medium' | 'high' : riskFromSize(sizePct);

  if (raw?.action === 'buy') {
    action = 'buy';
    side = 'long';
  }

  if (!Number.isFinite(confidence)) confidence = 0.5;
  const reasonSummary = typeof raw?.reasonSummary === 'string' && raw.reasonSummary.trim()
    ? raw.reasonSummary.trim().slice(0, 500)
    : 'LLM returned a structured decision without a rationale.';

  return {
    action,
    side,
    confidence,
    sizePct: parseFloat(sizePct.toFixed(4)),
    riskLevel,
    reasonSummary,
  };
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM content did not contain JSON');
  return match[0];
}

function riskFromSize(sizePct: number): 'low' | 'medium' | 'high' {
  if (sizePct <= 0.012) return 'low';
  if (sizePct <= 0.03) return 'medium';
  return 'high';
}

function minTradePct(maxSizePct: number): number {
  return Math.min(0.002, Math.max(0.0005, maxSizePct));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
