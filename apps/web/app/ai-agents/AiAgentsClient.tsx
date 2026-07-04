'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type FleetDecision = {
  id: string;
  agentId: string;
  agentName: string;
  symbol: string;
  action: 'buy' | 'sell' | string;
  side: string;
  confidence: number;
  sizePct: number;
  riskLevel: string;
  reasonSummary: string;
  langfuseTraceId: string | null;
  status: string;
  createdAt: string;
  marketSnapshot: null | {
    price: number;
    totalEquity: number;
    rsi14: number | null;
    trendScore: number;
    volatilityScore: number;
  };
  riskChecks: Array<{ name: string; passed: boolean; message: string | null }>;
  toolCalls: Array<{ step: number; toolName: string; latencyMs: number; input: unknown; output: unknown }>;
  personality: string;
  investmentStyle: string;
  riskPreference: string;
};

export type FleetData = {
  summary: {
    total: number;
    active: number;
    paused: number;
    stopped: number;
    totalPnl: number;
    totalTrades: number;
    decisions24h: number;
    executed24h: number;
    rejected24h: number;
    held24h: number;
    openPositions: number;
    netExposure: number;
  };
  actionMix: Record<string, number>;
  symbols: Array<{ symbol: string; total: number; buy: number; sell: number; hold: number; close: number; avgConfidence: number; netBias: number }>;
  styles: Array<{ style: string; total: number; pnl: number; avgConfidence: number }>;
  personalities?: Array<{ personality: string; total: number; pnl: number; avgConfidence: number; buy: number; sell: number; netBias: number }>;
  performance?: {
    profiles: AgentPerformance[];
    rankedProfiles: AgentPerformance[];
  };
  riskMix: Record<string, number>;
  latest: FleetDecision[];
  agents: Array<{ id: string; personality: string; investmentStyle: string; riskPreference: string; status: string; model: string; symbol: string; openPositions?: OpenPosition[]; netExposure?: number }>;
};

type OpenPosition = {
  symbol: string;
  size: number;
  avgCost: number;
  currentPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  direction: 'long' | 'short' | string;
  notional: number;
};

type AgentPerformance = {
  agentId: string;
  name: string;
  displayName: string;
  symbol: string;
  personality: string;
  investmentStyle: string;
  riskPreference: string;
  initialEquity: number;
  lastEquity: number;
  pnl: number;
  pnlPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  openPositions: OpenPosition[];
  netExposure: number;
  decisions: number;
  winRate: number | null;
  closedSamples?: number;
  maxDrawdownPct: number;
  performanceScore: number;
  riskScore: number;
  curve: Array<{ at: string; equity: number; pnl: number; pnlPct: number; action: string; symbol: string; confidence: number }>;
};

type SwarmView = 'swarm' | 'personality' | 'style' | 'symbol' | 'risk';

const SYMBOLS = ['BTC', 'ETH', 'TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR'];

const PERSONALITY_LABELS: Record<string, string> = {
  aggressive: 'Aggressive',
  patient: 'Patient',
  defensive: 'Defensive',
  analytical: 'Analytical',
  chaotic: 'Chaotic',
  buffett_value_oracle: 'Buffett Value',
  munger_quality_filter: 'Munger Quality',
  soros_reflexive_macro: 'Soros Macro',
  dalio_all_weather: 'Dalio All Weather',
  lynch_growth_hunter: 'Lynch Growth',
  burry_contrarian_short: 'Burry Contrarian',
  simons_quant_machine: 'Simons Quant',
  druckenmiller_macro_sniper: 'Druckenmiller',
  wood_disruptive_growth: 'Wood Disruptive',
  ackman_activist_focus: 'Ackman Focus',
  tudor_jones_risk_tactician: 'Tudor Jones',
  ruckenstein_deep_value: 'Deep Value',
  livermore_tape_reader: 'Livermore Tape',
  graham_margin_safety: 'Graham Safety',
  icahn_event_driven: 'Icahn Event',
  tepper_distressed_hunter: 'Tepper Distressed',
  trump_deal_maker: 'Trump Deal',
  musk_moonshot_operator: 'Musk Moonshot',
  cathie_innovation_bull: 'Cathie Innovation',
  renaissance_stat_arb: 'Renaissance Arb',
};

function label(v: string) {
  return PERSONALITY_LABELS[v] || v.replaceAll('_', ' ');
}

function shortLabel(v: string, max = 14) {
  const text = label(v);
  return text.length > max ? `${text.slice(0, max - 1)}.` : text;
}

function money(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function pnlPct(v: number) {
  const abs = Math.abs(v);
  const digits = abs > 1 ? 2 : abs > 0.01 ? 3 : 4;
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function metricPct(v: number) {
  const abs = Math.abs(v);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `${v.toFixed(digits)}%`;
}

function winRateText(v: number | null | undefined) {
  return typeof v === 'number' ? pct(v) : '--';
}

function actionTone(action: string) {
  return action === 'buy'
    ? 'border-[#00E28A]/40 bg-[#00E28A]/12 text-[#00E28A] shadow-[0_0_24px_rgba(0,226,138,0.16)]'
    : 'border-[#FF355D]/40 bg-[#FF355D]/12 text-[#FF355D] shadow-[0_0_24px_rgba(255,53,93,0.16)]';
}

function biasGradient(netBias: number) {
  if (netBias > 0.15) return 'from-[#00E28A] via-[#28D7FF] to-[#1E6FFF]';
  if (netBias < -0.15) return 'from-[#FF355D] via-[#FF9D2E] to-[#FFD166]';
  return 'from-slate-500 via-slate-400 to-slate-600';
}

function agentTone(agent: AgentPerformance) {
  if (agent.pnlPct > 0.001) return { fill: '#00E28A', glow: 'rgba(0,226,138,0.48)', text: 'text-[#00E28A]' };
  if (agent.pnlPct < -0.001) return { fill: '#FF355D', glow: 'rgba(255,53,93,0.46)', text: 'text-[#FF355D]' };
  return { fill: '#28D7FF', glow: 'rgba(40,215,255,0.42)', text: 'text-[#28D7FF]' };
}

function riskRing(risk: string) {
  if (risk === 'high') return '#FF355D';
  if (risk === 'medium') return '#FFD166';
  return '#00E28A';
}

function stableHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  return hash;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildSwarmNodes(agents: AgentPerformance[], view: SwarmView) {
  const width = 100;
  const height = 100;
  const styleCenters: Record<string, { x: number; y: number }> = {
    trend_following: { x: 22, y: 26 },
    mean_reversion: { x: 50, y: 23 },
    breakout: { x: 78, y: 28 },
    contrarian: { x: 34, y: 70 },
    defensive: { x: 70, y: 70 },
  };
  const symbolCenters = Object.fromEntries(SYMBOLS.map((symbol, i) => {
    const angle = (i / SYMBOLS.length) * Math.PI * 2 - Math.PI / 2;
    return [symbol, { x: 50 + Math.cos(angle) * 33, y: 52 + Math.sin(angle) * 28 }];
  })) as Record<string, { x: number; y: number }>;
  const personalities = Array.from(new Set(agents.map((agent) => agent.personality))).sort();
  const personalityCenters = Object.fromEntries(personalities.map((personality, i) => {
    const angle = (i / Math.max(1, personalities.length)) * Math.PI * 2 - Math.PI / 2;
    const ring = i % 3 === 0 ? 32 : i % 3 === 1 ? 24 : 16;
    return [personality, { x: 50 + Math.cos(angle) * ring, y: 52 + Math.sin(angle) * ring * 0.78 }];
  })) as Record<string, { x: number; y: number }>;

  return agents.map((agent, index) => {
    const hash = stableHash(agent.agentId);
    const jitterX = ((hash % 100) / 100 - 0.5) * 10;
    const jitterY = (((hash >> 8) % 100) / 100 - 0.5) * 10;
    let x = 50;
    let y = 50;

    if (view === 'personality') {
      const center = personalityCenters[agent.personality] || { x: 50, y: 50 };
      x = center.x + jitterX * 0.75;
      y = center.y + jitterY * 0.75;
    } else if (view === 'style') {
      const center = styleCenters[agent.investmentStyle] || { x: 50, y: 50 };
      x = center.x + jitterX;
      y = center.y + jitterY;
    } else if (view === 'symbol') {
      const center = symbolCenters[agent.symbol] || { x: 50, y: 50 };
      x = center.x + jitterX;
      y = center.y + jitterY;
    } else if (view === 'risk') {
      const riskValue = clampNumber(agent.maxDrawdownPct * 80 + agent.riskScore * 2, 0, 100);
      const pnlValue = clampNumber(50 - agent.pnlPct * 6000, 8, 92);
      x = 12 + riskValue * 0.76 + jitterX * 0.25;
      y = pnlValue + jitterY * 0.2;
    } else {
      const angle = index * 2.399963 + (hash % 17) * 0.03;
      const radius = 8 + Math.sqrt(index + 1) * 7.8;
      x = 50 + Math.cos(angle) * radius + jitterX * 0.35;
      y = 50 + Math.sin(angle) * radius * 0.68 + jitterY * 0.35;
    }

    const exposure = Math.log10(Math.max(10, agent.netExposure || Math.abs(agent.pnl) || 10));
    const size = clampNumber(14 + exposure * 4.8 + Math.abs(agent.pnlPct) * 620, 20, 46);
    const depth = clampNumber(1 - y / height, 0, 1);
    return {
      agent,
      x: clampNumber(x, 7, 93),
      y: clampNumber(y, 10, 88),
      size,
      depth,
      zIndex: Math.round(depth * 1000 + size),
    };
  });
}

export default function AiAgentsClient({ initialFleet }: { initialFleet: FleetData | null }) {
  const [fleet, setFleet] = useState<FleetData | null>(initialFleet);
  const [selected, setSelected] = useState<FleetDecision | null>(initialFleet?.latest?.[0] || null);
  const [symbol, setSymbol] = useState('BTC');
  const [bulkCount, setBulkCount] = useState(100);
  const [selectedPerfId, setSelectedPerfId] = useState<string | null>(null);
  const [hoveredPerfId, setHoveredPerfId] = useState<string | null>(null);
  const [swarmView, setSwarmView] = useState<SwarmView>('swarm');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();

  async function load() {
    try {
      setError(null);
      const data = await api.get<FleetData>('/api/v1/ai-agents/fleet');
      setFleet(data);
      setSelected((prev) => prev ? data.latest.find((d) => d.id === prev.id) || data.latest[0] || null : data.latest[0] || null);
    } catch (err: any) {
      setError(err.message || t('Failed to load AI fleet'));
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  async function createBulk() {
    setCreating(true);
    setError(null);
    try {
      await api.post('/api/v1/ai-agents/bulk', {
        count: bulkCount,
        symbols: [symbol],
        decisionIntervalSeconds: 1800,
        cooldownSeconds: 1800,
      });
      await load();
    } catch (err: any) {
      setError(err.message || t('Failed to create AI agents'));
    } finally {
      setCreating(false);
    }
  }

  const summary = fleet?.summary;
  const buyVotes = fleet?.latest.filter((d) => d.action === 'buy').length || 0;
  const sellVotes = fleet?.latest.filter((d) => d.action === 'sell').length || 0;
  const totalVotes = Math.max(1, buyVotes + sellVotes);
  const buyPressure = buyVotes / totalVotes;
  const topSymbol = fleet?.symbols?.[0];
  const rankedProfiles = fleet?.performance?.rankedProfiles || [];
  const allProfiles = fleet?.performance?.profiles || [];
  const selectedPerformance = useMemo(() => {
    return allProfiles.find((p) => p.agentId === selectedPerfId)
      || (selected ? allProfiles.find((p) => p.agentId === selected.agentId) : null)
      || rankedProfiles[0]
      || allProfiles[0]
      || null;
  }, [allProfiles, selected, selectedPerfId, rankedProfiles]);
  const hoveredPerformance = useMemo(
    () => allProfiles.find((p) => p.agentId === hoveredPerfId) || null,
    [allProfiles, hoveredPerfId]
  );
  const compareProfiles = useMemo(
    () => compareIds.map((id) => allProfiles.find((p) => p.agentId === id)).filter(Boolean) as AgentPerformance[],
    [compareIds, allProfiles]
  );

  function addCompare(agentId: string) {
    setCompareIds((prev) => {
      if (prev.includes(agentId)) return prev;
      return [...prev.slice(-2), agentId];
    });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#05070B] text-slate-100">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(40,215,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(40,215,255,0.06)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute left-0 right-0 top-0 h-[420px] bg-[radial-gradient(circle_at_20%_10%,rgba(0,226,138,0.18),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(255,53,93,0.16),transparent_34%)]" />
      </div>

      <div className="relative mx-auto max-w-[1920px] px-4 py-4 lg:px-6">
        <header className="mb-4 grid gap-4 xl:grid-cols-[1fr_560px]">
          <section className="border border-white/10 bg-[#091018]/82 p-5 shadow-[0_0_48px_rgba(30,111,255,0.12)] backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.34em] text-[#28D7FF]">{t('AgentTrade Neural Trading Command')}</div>
                <h1 className="mt-2 text-4xl font-black leading-none text-white md:text-6xl">{t('AI Decision Wall')}</h1>
                <p className="mt-3 max-w-3xl text-sm text-slate-400">
                  {t('30-minute LLM agent loop, tool calls, buy/sell allocation, Langfuse trace, investor-style personality swarm.')}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="AI" value={summary?.total ?? 0} />
                <Kpi label="Active" value={summary?.active ?? 0} tone="green" />
                <Kpi label="24h Decisions" value={summary?.decisions24h ?? 0} />
                <Kpi label="Trades" value={summary?.totalTrades ?? 0} tone="blue" />
                <Kpi label="Open Pos" value={summary?.openPositions ?? 0} tone="green" />
                <Kpi label="Exposure" value={money(summary?.netExposure ?? 0)} tone="blue" />
              </div>
            </div>
          </section>

          <section className="border border-white/10 bg-[#091018]/82 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{t('Deploy Swarm')}</div>
                <div className="text-lg font-black text-white">{t('Launch up to 1000 AI traders')}</div>
              </div>
              <div className="h-2 w-2 bg-[#00E28A] shadow-[0_0_16px_#00E28A]" />
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-11 border border-white/10 bg-[#050A10] px-3 text-sm text-white outline-none">
                {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input
                type="number"
                min={1}
                max={1000}
                value={bulkCount}
                onChange={(e) => setBulkCount(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
                className="h-11 border border-white/10 bg-[#050A10] px-3 text-sm text-white outline-none"
              />
              <button onClick={createBulk} disabled={creating} className="col-span-2 h-11 bg-[#1E6FFF] text-sm font-black text-white transition hover:bg-[#28D7FF] disabled:opacity-60">
                {creating ? t('DEPLOYING...') : t('DEPLOY AI PERSONALITY SWARM')}
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Tiny label="Loop" value="30m" />
              <Tiny label="Cooldown" value="30m" />
              <Tiny label="Tracing" value="Langfuse" tone="green" />
              <Tiny label="Tools" value="Market + Risk" tone="green" />
            </div>
            <div className="mt-4 border border-white/10 bg-[#050A10] p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-600">
                <span>{t('Execution Pulse')}</span>
                <span className="text-[#00E28A]">{summary?.active ?? 0} {t('online')}</span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {Array.from({ length: 36 }).map((_, index) => {
                  const active = index < Math.min(36, Math.round(((summary?.executed24h ?? 0) / Math.max(1, summary?.decisions24h ?? 1)) * 36));
                  return <div key={index} className={clsx('h-2 border border-white/10', active ? 'bg-[#00E28A] shadow-[0_0_10px_rgba(0,226,138,0.42)]' : 'bg-[#0D1622]')} />;
                })}
              </div>
            </div>
          </section>
        </header>

        {error && <div className="mb-4 border border-[#FF355D]/40 bg-[#FF355D]/10 p-3 text-sm text-[#FF6E88]">{error}</div>}

        <section className="mb-4">
          <Panel title="AI Swarm Performance Map" subtitle="Live performance topology, style clusters, symbol clusters, and risk-return projection">
            <div className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
              <SwarmMap
                agents={allProfiles}
                rankedAgents={rankedProfiles}
                selectedId={selectedPerformance?.agentId || null}
                hoveredAgent={hoveredPerformance}
                view={swarmView}
                compareProfiles={compareProfiles}
                onViewChange={setSwarmView}
                onHover={setHoveredPerfId}
                onSelect={setSelectedPerfId}
                onCompare={addCompare}
                onRemoveCompare={(id) => setCompareIds((prev) => prev.filter((agentId) => agentId !== id))}
              />

              <AgentDossier agent={selectedPerformance} />
            </div>
          </Panel>
        </section>

        <section className="mb-4">
          <Panel title="Fleet Signal Board" subtitle="Pressure, symbol consensus, and strongest current target">
            <div className="grid gap-4 xl:grid-cols-[0.75fr_1.45fr_0.8fr]">
              <div className="border border-white/10 bg-[#050A10] p-3">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{t('Pressure')}</div>
                    <div className="mt-1 text-4xl font-black text-white">{pct(buyPressure)}</div>
                  </div>
                  <div className="text-right text-xs uppercase tracking-[0.16em] text-slate-500">
                    <div><span className="text-[#00E28A]">{buyVotes}</span> {t('buy')}</div>
                    <div><span className="text-[#FF355D]">{sellVotes}</span> {t('sell')}</div>
                  </div>
                </div>
                <div className="flex h-4 overflow-hidden border border-white/10 bg-slate-900">
                  <div className="bg-[#00E28A] shadow-[0_0_18px_rgba(0,226,138,0.45)]" style={{ width: `${buyPressure * 100}%` }} />
                  <div className="bg-[#FF355D] shadow-[0_0_18px_rgba(255,53,93,0.38)]" style={{ width: `${(1 - buyPressure) * 100}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Tiny label="Executed 24h" value={String(summary?.executed24h ?? 0)} tone="green" />
                  <Tiny label="Fleet P&L" value={money(summary?.totalPnl ?? 0)} tone={(summary?.totalPnl ?? 0) >= 0 ? 'green' : 'red'} />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {(fleet?.symbols || []).slice(0, 8).map((s) => (
                  <div key={s.symbol} className="border border-white/10 bg-[#050A10] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-lg font-black text-white">{s.symbol}</div>
                      <div className={clsx('text-xs font-black', s.netBias >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{s.netBias >= 0 ? t('BUY') : t('SELL')}</div>
                    </div>
                    <div className="h-1.5 overflow-hidden bg-slate-800">
                      <div className={clsx('h-full bg-gradient-to-r', biasGradient(s.netBias))} style={{ width: `${Math.max(8, Math.min(100, Math.abs(s.netBias) * 50 + 50))}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>{s.total} {t('votes')}</span>
                      <span>{pct(s.avgConfidence)}</span>
                    </div>
                  </div>
                ))}
                {!fleet?.symbols?.length && <Empty text="No decisions yet" />}
              </div>

              <div className="border border-white/10 bg-[#050A10] p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{t('Command Target')}</div>
                <div className="mt-2 text-6xl font-black leading-none text-white">{topSymbol?.symbol || '--'}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Tiny label="Net Bias" value={(topSymbol?.netBias ?? 0).toFixed(2)} tone={(topSymbol?.netBias ?? 0) >= 0 ? 'green' : 'red'} />
                  <Tiny label="Avg Conf" value={pct(topSymbol?.avgConfidence ?? 0)} />
                  <Tiny label="Risk Low" value={String(fleet?.riskMix?.low ?? 0)} />
                  <Tiny label="Risk High" value={String(fleet?.riskMix?.high ?? 0)} tone="red" />
                </div>
              </div>
            </div>
          </Panel>
        </section>

        <section>
          <Panel title="Decision Console" subtitle={selected ? `${label(selected.personality)} · ${selected.symbol} · ${t(selected.action.toUpperCase())}` : 'Live decisions and trace detail'}>
            <div className="grid gap-4 2xl:grid-cols-[1fr_600px]">
              <div className="max-h-[560px] divide-y divide-white/10 overflow-y-auto border border-white/10 bg-[#050A10]">
                {(fleet?.latest || []).map((d) => (
                  <button key={d.id} onClick={() => setSelected(d)} className={clsx('w-full p-3 text-left transition hover:bg-white/[0.04]', selected?.id === d.id && 'bg-[#1E6FFF]/12')}>
                    <div className="grid gap-3 lg:grid-cols-[150px_1fr_112px] lg:items-center">
                      <div>
                        <div className={clsx('inline-flex border px-3 py-1 text-xs font-black', actionTone(d.action))}>{t(d.action.toUpperCase())} {d.symbol}</div>
                        <div className="mt-2 text-[11px] text-slate-500">{new Date(d.createdAt).toLocaleTimeString(locale)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">{label(d.personality)} · {d.investmentStyle.replaceAll('_', ' ')}</div>
                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-400">{d.reasonSummary}</p>
                        <div className="mt-1 truncate text-[11px] text-slate-600">{d.langfuseTraceId}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Tiny label="Alloc" value={pct(d.sizePct)} tone={d.action === 'buy' ? 'green' : 'red'} />
                        <Tiny label="Conf" value={pct(d.confidence)} />
                      </div>
                    </div>
                  </button>
                ))}
                {!fleet?.latest?.length && <Empty text="No live decisions yet" />}
              </div>

              <div className="border border-white/10 bg-[#050A10] p-3">
                {selected ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <Tiny label="Action" value={t(selected.action.toUpperCase())} tone={selected.action === 'buy' ? 'green' : 'red'} />
                      <Tiny label="Allocation" value={pct(selected.sizePct)} />
                      <Tiny label="Status" value={t(selected.status)} tone={selected.status === 'executed' ? 'green' : selected.status === 'failed' ? 'red' : undefined} />
                    </div>
                    <div className="border border-white/10 bg-[#091018] p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-600">{t('LLM Rationale')}</div>
                      <p className="text-sm leading-relaxed text-slate-300">{selected.reasonSummary}</p>
                    </div>
                    {selected.marketSnapshot && (
                      <div className="grid grid-cols-3 gap-2">
                        <Tiny label="Price" value={money(selected.marketSnapshot.price)} />
                        <Tiny label="RSI" value={selected.marketSnapshot.rsi14?.toFixed(1) ?? t('n/a')} />
                        <Tiny label="Trend" value={selected.marketSnapshot.trendScore.toFixed(2)} />
                      </div>
                    )}
                    <div className="border border-white/10 bg-[#091018] p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-600">{t('Tool Chain')}</div>
                      <div className="grid gap-2">
                        {selected.toolCalls.map((tool) => (
                          <div key={tool.step} className="flex items-center justify-between border border-white/10 bg-[#050A10] px-3 py-2">
                            <span className="text-sm font-bold text-white">{tool.step}. {tool.toolName}</span>
                            <span className="text-xs text-slate-500">{tool.latencyMs}{t('ms')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="break-all border border-white/10 bg-[#091018] p-3 text-xs text-slate-500">
                      {t('Langfuse trace')}: {selected.langfuseTraceId || t('n/a')}
                    </div>
                  </div>
                ) : <Empty text="Select a decision" />}
              </div>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const { t } = useI18n();

  return (
    <section className="border border-white/10 bg-[#091018]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">{t(title)}</h2>
          <div className="mt-1 text-xs text-slate-500">{t(subtitle)}</div>
        </div>
        <div className="h-2 w-8 bg-[#28D7FF] shadow-[0_0_18px_rgba(40,215,255,0.65)]" />
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'green' | 'red' | 'blue' }) {
  const { t } = useI18n();

  return (
    <div className="min-w-[112px] border border-white/10 bg-[#050A10] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">{t(label)}</div>
      <div className={clsx('mt-1 truncate text-2xl font-black tabular-nums', tone === 'green' ? 'text-[#00E28A]' : tone === 'red' ? 'text-[#FF355D]' : tone === 'blue' ? 'text-[#28D7FF]' : 'text-white')}>{value}</div>
    </div>
  );
}

function SwarmMap({
  agents,
  rankedAgents,
  selectedId,
  hoveredAgent,
  view,
  compareProfiles,
  onViewChange,
  onHover,
  onSelect,
  onCompare,
  onRemoveCompare,
}: {
  agents: AgentPerformance[];
  rankedAgents: AgentPerformance[];
  selectedId: string | null;
  hoveredAgent: AgentPerformance | null;
  view: SwarmView;
  compareProfiles: AgentPerformance[];
  onViewChange: (view: SwarmView) => void;
  onHover: (agentId: string | null) => void;
  onSelect: (agentId: string) => void;
  onCompare: (agentId: string) => void;
  onRemoveCompare: (agentId: string) => void;
}) {
  const { t } = useI18n();
  const nodes = useMemo(() => buildSwarmNodes(agents, view), [agents, view]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.agent.agentId, node])), [nodes]);
  const personalityClusters = useMemo(() => {
    const clusters = new Map<string, { personality: string; agents: number; pnl: number; avgPnlPct: number; trades: number; exposure: number; buy: number; sell: number }>();
    for (const agent of agents) {
      const cluster = clusters.get(agent.personality) || {
        personality: agent.personality,
        agents: 0,
        pnl: 0,
        avgPnlPct: 0,
        trades: 0,
        exposure: 0,
        buy: 0,
        sell: 0,
      };
      cluster.agents += 1;
      cluster.pnl += agent.pnl;
      cluster.avgPnlPct += agent.pnlPct;
      cluster.trades += agent.totalTrades;
      cluster.exposure += agent.netExposure;
      const lastAction = agent.curve?.[agent.curve.length - 1]?.action;
      if (lastAction === 'buy') cluster.buy += 1;
      if (lastAction === 'sell') cluster.sell += 1;
      clusters.set(agent.personality, cluster);
    }
    return Array.from(clusters.values())
      .map((cluster) => ({ ...cluster, avgPnlPct: cluster.agents ? cluster.avgPnlPct / cluster.agents : 0 }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 6);
  }, [agents]);
  const links = useMemo(() => {
    const out: Array<{ a: ReturnType<typeof buildSwarmNodes>[number]; b: ReturnType<typeof buildSwarmNodes>[number]; tone: string }> = [];
    for (let i = 0; i < rankedAgents.length; i++) {
      const current = nodeById.get(rankedAgents[i].agentId);
      const next = nodeById.get(rankedAgents[i + 1]?.agentId || '');
      if (current && next) out.push({ a: current, b: next, tone: 'rgba(40,215,255,0.18)' });
    }
    const bySymbol = new Map<string, ReturnType<typeof buildSwarmNodes>[number][]>();
    for (const node of nodes) {
      const groupKey = view === 'personality' ? node.agent.personality : node.agent.symbol;
      const group = bySymbol.get(groupKey) || [];
      if (group.length < 3) group.push(node);
      bySymbol.set(groupKey, group);
    }
    for (const group of bySymbol.values()) {
      for (let i = 1; i < group.length; i++) out.push({ a: group[0], b: group[i], tone: 'rgba(255,255,255,0.08)' });
    }
    return out.slice(0, 64);
  }, [nodeById, nodes, rankedAgents, view]);

  const leader = rankedAgents[0] || null;
  const weakest = rankedAgents.length ? rankedAgents[rankedAgents.length - 1] : null;
  const hoverNode = hoveredAgent ? nodeById.get(hoveredAgent.agentId) : null;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
        <div className="relative min-h-[620px] overflow-hidden border border-white/10 bg-[#050A10] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [perspective:1100px]">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(40,215,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(40,215,255,0.05)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(ellipse_at_center,rgba(40,215,255,0.16),transparent_62%)]" />
          <div className="absolute left-4 top-4 z-30 flex flex-wrap gap-2">
            {([
              ['swarm', 'Swarm'],
              ['personality', 'Personality'],
              ['style', 'Style'],
              ['symbol', 'Symbol'],
              ['risk', 'Risk/Return'],
            ] as Array<[SwarmView, string]>).map(([key, text]) => (
              <button
                key={key}
                onClick={() => onViewChange(key)}
                className={clsx(
                  'border px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition',
                  view === key ? 'border-[#28D7FF]/70 bg-[#1E6FFF]/30 text-white shadow-[0_0_18px_rgba(40,215,255,0.28)]' : 'border-white/10 bg-[#091018]/80 text-slate-500 hover:text-white'
                )}
              >
                {t(text)}
              </button>
            ))}
          </div>

          {view === 'risk' && (
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="absolute bottom-8 left-8 right-8 border-t border-white/15 text-[10px] uppercase tracking-[0.18em] text-slate-600">
                <span className="absolute right-0 top-2">{t('Risk')}</span>
              </div>
              <div className="absolute bottom-8 left-8 top-20 border-l border-white/15 text-[10px] uppercase tracking-[0.18em] text-slate-600">
                <span className="absolute -left-2 top-0 -translate-x-full">{t('Return')}</span>
              </div>
            </div>
          )}

          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {links.map((link, index) => (
              <line
                key={`${link.a.agent.agentId}-${link.b.agent.agentId}-${index}`}
                x1={link.a.x}
                y1={link.a.y}
                x2={link.b.x}
                y2={link.b.y}
                stroke={link.tone}
                strokeWidth={link.a.agent.symbol === link.b.agent.symbol ? 0.22 : 0.16}
              />
            ))}
          </svg>

          <div className="absolute inset-0 z-20 origin-center [transform:rotateX(9deg)_rotateZ(-1deg)]">
            {nodes.map((node) => {
              const tone = agentTone(node.agent);
              const selected = node.agent.agentId === selectedId;
              const hot = node.agent.curve?.[node.agent.curve.length - 1]?.action !== 'mark';
              return (
                <button
                  key={node.agent.agentId}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', node.agent.agentId)}
                  onMouseEnter={() => onHover(node.agent.agentId)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(node.agent.agentId)}
                  onBlur={() => onHover(null)}
                  onClick={() => onSelect(node.agent.agentId)}
                  className={clsx(
                    'absolute rounded-full border text-left transition duration-200 hover:scale-110 focus:outline-none',
                    selected ? 'border-white shadow-[0_0_34px_rgba(255,255,255,0.38)]' : 'border-white/30'
                  )}
                  style={{
                    left: `${node.x}%`,
                    top: `${node.y}%`,
                    width: node.size,
                    height: node.size,
                    marginLeft: -node.size / 2,
                    marginTop: -node.size / 2,
                    zIndex: node.zIndex,
                    background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.82), ${tone.fill} 30%, rgba(5,10,16,0.96) 72%)`,
                    boxShadow: `0 ${6 + node.depth * 11}px ${14 + node.size * 0.34}px ${tone.glow}, inset 0 0 14px rgba(255,255,255,0.16)`,
                    borderColor: riskRing(node.agent.riskPreference),
                  }}
                  title={`${label(node.agent.personality)} ${node.agent.symbol} ${pnlPct(node.agent.pnlPct)}`}
                >
                  <span className="pointer-events-none absolute inset-[22%] rounded-full border border-white/20 bg-black/20" />
                  <span className="pointer-events-none absolute -bottom-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[10px] font-black uppercase text-slate-300 md:block">
                    {view === 'personality' ? shortLabel(node.agent.personality) : node.agent.symbol}
                  </span>
                  {hot && <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.85)]" />}
                </button>
              );
            })}
          </div>

          {hoveredAgent && hoverNode && (
            <div
              className="pointer-events-none absolute z-40 w-[280px] border border-white/15 bg-[#091018]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.48)] backdrop-blur"
              style={{
                left: `${clampNumber(hoverNode.x, 18, 76)}%`,
                top: `${clampNumber(hoverNode.y, 18, 70)}%`,
                transform: 'translate(18px, -20px)',
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white">{label(hoveredAgent.personality)}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-slate-500">{hoveredAgent.symbol} · {hoveredAgent.investmentStyle.replaceAll('_', ' ')}</div>
                </div>
                <div className={clsx('text-sm font-black tabular-nums', agentTone(hoveredAgent).text)}>{pnlPct(hoveredAgent.pnlPct)}</div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <Tiny label="P&L" value={money(hoveredAgent.pnl)} tone={hoveredAgent.pnl >= 0 ? 'green' : 'red'} />
                <Tiny label="Win Rate" value={winRateText(hoveredAgent.winRate)} />
                <Tiny label="DD" value={metricPct(hoveredAgent.maxDrawdownPct)} tone="red" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Tiny label="Trades" value={String(hoveredAgent.totalTrades)} />
                <Tiny label="Exposure" value={money(hoveredAgent.netExposure)} />
              </div>
            </div>
          )}

          {!agents.length && <div className="absolute inset-0 z-30 grid place-items-center"><Empty text="No performance data yet" /></div>}
        </div>

        <div className="grid content-start gap-3">
          <div className="border border-white/10 bg-[#050A10] p-3">
            <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('Swarm Readout')}</div>
            <div className="grid grid-cols-2 gap-2">
              <Tiny label="Nodes" value={String(agents.length)} />
              <Tiny label="View" value={view === 'personality' ? 'PERSONA' : view.toUpperCase()} />
              <Tiny label="Leader" value={leader ? label(leader.personality) : '--'} tone="green" />
              <Tiny label="Lagging" value={weakest ? label(weakest.personality) : '--'} tone="red" />
            </div>
          </div>

          {view === 'personality' && (
            <div className="border border-white/10 bg-[#050A10] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('Personality Clusters')}</div>
                <div className="text-xs text-slate-600">{personalityClusters.length}</div>
              </div>
              <div className="space-y-2">
                {personalityClusters.map((cluster) => {
                  const bias = cluster.buy - cluster.sell;
                  return (
                    <button
                      key={cluster.personality}
                      onClick={() => {
                        const first = agents.find((agent) => agent.personality === cluster.personality);
                        if (first) onSelect(first.agentId);
                      }}
                      className="w-full border border-white/10 bg-[#091018] p-2 text-left hover:border-[#28D7FF]/50"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black text-white">{label(cluster.personality)}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-600">{cluster.agents} {t('agents')} · {cluster.trades} {t('trades')}</div>
                        </div>
                        <div className={clsx('text-xs font-black tabular-nums', cluster.pnl >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{money(cluster.pnl)}</div>
                      </div>
                      <div className="h-1.5 bg-slate-800">
                        <div
                          className={clsx('h-full bg-gradient-to-r', biasGradient(bias / Math.max(1, cluster.agents)))}
                          style={{ width: `${Math.max(10, Math.min(100, Math.abs(cluster.avgPnlPct) * 2 + 42))}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-slate-600">
                        <span>{bias >= 0 ? t('BUY') : t('SELL')} {Math.abs(bias)}</span>
                        <span className={cluster.avgPnlPct >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]'}>{pnlPct(cluster.avgPnlPct)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const agentId = event.dataTransfer.getData('text/plain');
              if (agentId) onCompare(agentId);
            }}
            className="min-h-[184px] border border-dashed border-[#28D7FF]/35 bg-[#071522]/70 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#28D7FF]">{t('Compare Dock')}</div>
              <div className="text-xs text-slate-600">{compareProfiles.length}/3</div>
            </div>
            <div className="grid gap-2">
              {compareProfiles.map((agent) => (
                <div key={agent.agentId} className="border border-white/10 bg-[#050A10] p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-white">{label(agent.personality)}</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-600">{agent.symbol} · {agent.riskPreference}</div>
                    </div>
                    <button onClick={() => onRemoveCompare(agent.agentId)} className="px-2 text-xs font-black text-slate-500 hover:text-white">x</button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <Tiny label="PnL" value={pnlPct(agent.pnlPct)} tone={agent.pnlPct >= 0 ? 'green' : 'red'} />
                    <Tiny label="Win Rate" value={winRateText(agent.winRate)} />
                    <Tiny label="DD" value={metricPct(agent.maxDrawdownPct)} tone="red" />
                  </div>
                </div>
              ))}
              {!compareProfiles.length && <div className="grid h-24 place-items-center border border-white/10 bg-[#050A10] text-center text-xs uppercase tracking-[0.18em] text-slate-600">{t('Standby')}</div>}
            </div>
          </div>

          <div className="border border-white/10 bg-[#050A10] p-3">
            <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('Top Agents')}</div>
            <div className="space-y-2">
              {rankedAgents.slice(0, 5).map((agent, index) => (
                <button key={agent.agentId} onClick={() => onSelect(agent.agentId)} className="grid w-full grid-cols-[28px_1fr_auto] items-center gap-2 border border-white/10 bg-[#091018] px-2 py-2 text-left hover:border-[#28D7FF]/50">
                  <span className="text-xs font-black text-[#28D7FF]">{index + 1}</span>
                  <span className="min-w-0 truncate text-xs font-bold text-white">{label(agent.personality)}</span>
                  <span className={clsx('text-xs font-black tabular-nums', agent.pnlPct >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{pnlPct(agent.pnlPct)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentDossier({ agent }: { agent: AgentPerformance | null }) {
  const { t } = useI18n();
  if (!agent) return <Empty text="Select an agent" />;

  return (
    <div className="border border-white/10 bg-[#050A10] p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('Selected Agent')}</div>
              <h3 className="mt-2 truncate text-2xl font-black text-white">{label(agent.personality)}</h3>
              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{agent.symbol} · {agent.investmentStyle.replaceAll('_', ' ')} · {agent.riskPreference}</div>
            </div>
            <div className={clsx('text-right text-2xl font-black tabular-nums', agent.pnlPct >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{pnlPct(agent.pnlPct)}</div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('Selected Agent PnL Curve')}</div>
              <div className={clsx('text-xs font-black tabular-nums', agent.pnlPct >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{pnlPct(agent.pnlPct)}</div>
            </div>
            <MiniCurve points={agent.curve} positive={agent.pnlPct >= 0} />
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
            <MetricTile label="P&L" value={money(agent.pnl)} sub={`${t('Unrealized')} ${money(agent.unrealizedPnl || 0)}`} tone={agent.pnl >= 0 ? 'green' : 'red'} />
            <MetricTile label="Win Rate" value={winRateText(agent.winRate)} sub={`${agent.closedSamples ?? 0} ${t('closed samples')}`} />
            <MetricTile label="Drawdown" value={metricPct(agent.maxDrawdownPct)} sub="Peak-to-trough" tone="red" />
            <MetricTile label="Exposure" value={money(agent.netExposure)} sub={`${agent.openPositions?.length || 0} ${t('open positions')}`} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Tiny label="Trades" value={String(agent.totalTrades)} />
            <Tiny label="Decisions" value={String(agent.decisions)} />
            <Tiny label="Score" value={agent.performanceScore.toFixed(1)} tone={agent.performanceScore >= 0 ? 'green' : 'red'} />
          </div>

          <div className="border border-white/10 bg-[#050A10] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('Open Positions')}</div>
              <div className="text-xs text-slate-600">{agent.openPositions?.length || 0}</div>
            </div>
            <OpenPositions positions={agent.openPositions || []} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function OpenPositions({ positions, compact = false }: { positions: OpenPosition[]; compact?: boolean }) {
  const { t } = useI18n();
  if (!positions.length) {
    return <div className="border border-white/10 bg-[#050A10] p-3 text-xs text-slate-500">{t('Flat book')}</div>;
  }

  return (
    <div className={clsx('grid gap-2', compact ? '' : 'md:grid-cols-2')}>
      {positions.slice(0, compact ? 3 : 8).map((p) => {
        const isLong = p.size >= 0;
        return (
          <div key={p.symbol} className="border border-white/10 bg-[#050A10] p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-white">{p.symbol}</div>
              <div className={clsx('text-[11px] font-black uppercase', isLong ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{isLong ? t('LONG') : t('SHORT')}</div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <Tiny label="Size" value={Math.abs(p.size).toFixed(3)} tone={isLong ? 'green' : 'red'} />
              <Tiny label="P&L" value={money(p.unrealizedPnl || 0)} tone={(p.unrealizedPnl || 0) >= 0 ? 'green' : 'red'} />
              {!compact && <Tiny label="Avg" value={money(p.avgCost)} />}
              {!compact && <Tiny label="Mark" value={money(p.currentPrice || p.avgCost)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricTile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'green' | 'red' }) {
  const { t } = useI18n();

  return (
    <div className="min-w-0 border border-white/10 bg-[#050A10] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">{t(label)}</div>
      <div className={clsx('mt-2 truncate text-xl font-black tabular-nums', tone === 'green' ? 'text-[#00E28A]' : tone === 'red' ? 'text-[#FF355D]' : 'text-white')}>{value}</div>
      <div className="mt-1 truncate text-[11px] text-slate-500">{t(sub)}</div>
    </div>
  );
}

function PerformanceRow({ rank, agent, selected, onClick }: { rank: number; agent: AgentPerformance; selected: boolean; onClick: () => void }) {
  const positive = agent.pnlPct >= 0;
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full border p-3 text-left transition',
        selected ? 'border-[#28D7FF]/70 bg-[#071522]' : 'border-white/10 bg-[#050A10] hover:border-white/25'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center bg-[#28D7FF]/15 text-xs font-black text-[#28D7FF]">
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-black text-white">{label(agent.personality)}</div>
            <div className={clsx('text-xs font-black tabular-nums', positive ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{pnlPct(agent.pnlPct)}</div>
          </div>
          <div className="mt-1 truncate text-[11px] text-slate-500">{agent.symbol} · {agent.investmentStyle.replaceAll('_', ' ')} · score {agent.performanceScore.toFixed(1)}</div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Tiny label="Trades" value={String(agent.totalTrades)} />
            <Tiny label="Win Rate" value={winRateText(agent.winRate)} />
            <Tiny label="DD" value={metricPct(agent.maxDrawdownPct)} tone="red" />
          </div>
        </div>
      </div>
    </button>
  );
}

function MiniCurve({ points, positive }: { points: AgentPerformance['curve']; positive: boolean }) {
  const { t, locale } = useI18n();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 720;
  const height = 180;
  if (!points.length) {
    return <div className="grid h-[180px] place-items-center border border-white/10 bg-[#050A10] text-sm text-slate-500">{t('Waiting for equity snapshots')}</div>;
  }

  const values = points.map((p) => p.pnlPct);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = Math.max(0.01, max - min);
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? width : (i / (points.length - 1)) * width;
    const y = height - ((p.pnlPct - min) / range) * height;
    return { point: p, x, y };
  });
  const path = coords.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const zeroY = height - ((0 - min) / range) * height;
  const hover = hoverIndex === null ? null : coords[hoverIndex];

  return (
    <div className="relative border border-white/10 bg-[#050A10] p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[180px] w-full overflow-visible"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = clampNumber(((event.clientX - rect.left) / rect.width) * width, 0, width);
          setHoverIndex(Math.round((x / width) * (points.length - 1)));
        }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="rgba(148,163,184,0.25)" strokeDasharray="6 6" />
        <path d={path} fill="none" stroke={positive ? '#00E28A' : '#FF355D'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d={`${path} L${width},${height} L0,${height} Z`} fill={positive ? 'rgba(0,226,138,0.10)' : 'rgba(255,53,93,0.10)'} />
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1="0" y2={height} stroke="rgba(255,255,255,0.22)" strokeDasharray="5 5" />
            <circle cx={hover.x} cy={hover.y} r="6" fill={positive ? '#00E28A' : '#FF355D'} stroke="#fff" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-20 w-[210px] border border-white/15 bg-[#091018]/95 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur"
          style={{
            left: `${(clampNumber(hover.x, 90, width - 90) / width) * 100}%`,
            top: `${Math.max(10, Math.min(132, hover.y - 22))}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              {new Date(hover.point.at).toLocaleString(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className={clsx('text-xs font-black uppercase', hover.point.action === 'buy' ? 'text-[#00E28A]' : hover.point.action === 'sell' ? 'text-[#FF355D]' : 'text-slate-400')}>{t(hover.point.action)}</div>
          </div>
          <div className={clsx('text-xl font-black tabular-nums', hover.point.pnlPct >= 0 ? 'text-[#00E28A]' : 'text-[#FF355D]')}>{pnlPct(hover.point.pnlPct)}</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Tiny label="Equity" value={money(hover.point.equity)} />
            <Tiny label="Conf" value={pct(hover.point.confidence)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Tiny({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  const { t } = useI18n();

  return (
    <div className="min-w-0 border border-white/10 bg-[#050A10] p-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-600">{t(label)}</div>
      <div className={clsx('mt-1 truncate text-sm font-black tabular-nums', tone === 'green' ? 'text-[#00E28A]' : tone === 'red' ? 'text-[#FF355D]' : 'text-slate-200')}>{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  const { t } = useI18n();
  return <div className="border border-white/10 bg-[#050A10] p-8 text-center text-sm text-slate-500">{t(text)}</div>;
}
