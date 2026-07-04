import { Langfuse, LangfuseGenerationClient, LangfuseTraceClient } from 'langfuse';

let client: Langfuse | null | undefined;

function getLangfuse(): Langfuse | null {
  if (client !== undefined) return client;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';

  if (!publicKey || !secretKey) {
    client = null;
    return client;
  }

  client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl,
    release: process.env.APP_VERSION || 'local',
    environment: process.env.NODE_ENV || 'development',
    flushAt: parseInt(process.env.LANGFUSE_FLUSH_AT || '1', 10),
    flushInterval: parseInt(process.env.LANGFUSE_FLUSH_INTERVAL_MS || '1000', 10),
    requestTimeout: parseInt(process.env.LANGFUSE_REQUEST_TIMEOUT_MS || '5000', 10),
  });

  client.on('error', (err: any) => {
    console.error('[Langfuse] ingestion error:', err?.message || err);
  });

  return client;
}

export function langfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

export interface AiTraceInput {
  traceId: string;
  agent: {
    id: string;
    userId: string;
    name: string;
    symbol: string;
    personality: string;
    investmentStyle: string;
    riskPreference: string;
    model: string;
    promptVersion: string;
  };
  state: Record<string, unknown>;
  prompt: Record<string, unknown>;
}

export interface AiTraceHandle {
  traceId: string;
  trace?: LangfuseTraceClient;
  generation?: LangfuseGenerationClient;
}

export function startAiDecisionTrace(input: AiTraceInput): AiTraceHandle {
  const langfuse = getLangfuse();
  if (!langfuse) return { traceId: input.traceId };

  const trace = langfuse.trace({
    id: input.traceId,
    name: 'ai-trading-decision',
    userId: input.agent.userId,
    sessionId: input.agent.id,
    version: input.agent.promptVersion,
    input: input.prompt,
    metadata: {
      agentId: input.agent.id,
      agentName: input.agent.name,
      symbol: input.agent.symbol,
      personality: input.agent.personality,
      investmentStyle: input.agent.investmentStyle,
      riskPreference: input.agent.riskPreference,
      model: input.agent.model,
      marketState: input.state,
    },
    tags: [
      'ai-trading',
      input.agent.symbol,
      input.agent.personality,
      input.agent.investmentStyle,
      input.agent.riskPreference,
    ],
  });

  const generation = trace.generation({
    name: 'agent-decision',
    model: input.agent.model,
    input: input.prompt,
    metadata: {
      agentId: input.agent.id,
      promptVersion: input.agent.promptVersion,
      decisionIntervalSeconds: 1800,
    },
  });

  return { traceId: input.traceId, trace, generation };
}

export async function finishAiDecisionTrace(handle: AiTraceHandle, output: {
  decision: Record<string, unknown>;
  toolCalls?: Array<Record<string, unknown>>;
  riskChecks?: Array<Record<string, unknown>>;
  order?: Record<string, unknown> | null;
  status: string;
  pnl?: number | null;
  error?: string | null;
}) {
  try {
    handle.generation?.end({
      output,
      level: output.error ? 'ERROR' : 'DEFAULT',
      statusMessage: output.error || undefined,
    });

    handle.trace?.update({
      output,
      metadata: {
        status: output.status,
        pnl: output.pnl ?? null,
        riskChecks: output.riskChecks || [],
        order: output.order || null,
        error: output.error || null,
      },
    });

    if (handle.trace && typeof output.decision.confidence === 'number') {
      handle.trace.score({
        name: 'confidence',
        value: output.decision.confidence,
        comment: 'AI self-reported decision confidence',
      });
    }
    if (handle.trace && typeof output.pnl === 'number') {
      handle.trace.score({
        name: 'realized_pnl',
        value: output.pnl,
        comment: 'Realized PnL reported by execution layer for this decision',
      });
    }

    const langfuse = getLangfuse();
    await langfuse?.flushAsync();
  } catch (err: any) {
    console.error('[Langfuse] failed to finish AI trace:', err?.message || err);
  }
}

export function recordAiToolCallTrace(handle: AiTraceHandle, tool: {
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  latencyMs: number;
  step: number;
}) {
  try {
    const span = handle.trace?.span({
      name: `tool:${tool.name}`,
      input: tool.input,
      metadata: {
        step: tool.step,
        latencyMs: tool.latencyMs,
      },
    });
    span?.end({
      output: tool.output,
      metadata: {
        step: tool.step,
        latencyMs: tool.latencyMs,
      },
    });
  } catch (err: any) {
    console.error('[Langfuse] failed to record AI tool call:', err?.message || err);
  }
}

export async function shutdownLangfuse() {
  if (!client) return;
  await client.shutdownAsync();
}
