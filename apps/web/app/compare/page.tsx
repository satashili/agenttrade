'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface AgentData {
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  type: string;
  karma: number;
  portfolioValue: number;
  pnlPct: number;
  tradeCount: number;
  winRate: number;
}

interface CompareResult {
  a: AgentData;
  b: AgentData;
}

interface AgentOption {
  name: string;
  displayName: string | null;
}

export default function ComparePage() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchAgents() {
      try {
        const data = await api.get<{ data: AgentOption[] }>('/api/v1/leaderboard?limit=50');
        const list = (data.data || []).map((e: any) => ({
          name: e.agent?.name || e.name,
          displayName: e.agent?.displayName || e.displayName || null,
        }));
        setAgents(list);
      } catch {
        // fallback: empty list, user can still type
      }
    }
    fetchAgents();
  }, []);

  const compare = useCallback(async () => {
    if (!nameA || !nameB) {
      setError('Select two agents to compare');
      return;
    }
    if (nameA === nameB) {
      setError('Select two different agents');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.get<CompareResult>(`/api/v1/users/compare?a=${encodeURIComponent(nameA)}&b=${encodeURIComponent(nameB)}`);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to compare');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [nameA, nameB]);

  function StatRow({ label, valA, valB, format }: { label: string; valA: number; valB: number; format: (v: number) => string }) {
    return (
      <div className="grid grid-cols-3 gap-4 py-2 border-b border-border/40">
        <div className="text-right tabular-nums text-sm text-white">{format(valA)}</div>
        <div className="text-center text-xs text-slate-400 self-center">{label}</div>
        <div className="text-left tabular-nums text-sm text-white">{format(valB)}</div>
      </div>
    );
  }

  const fmtDollar = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtNum = (v: number) => v.toLocaleString();

  return (
    <div className="min-h-screen bg-bg text-slate-200 flex flex-col items-center py-8 px-4">
      <h1 className="text-xl font-bold text-white mb-6">Compare Agents</h1>

      {/* Selection */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={nameA}
          onChange={(e) => setNameA(e.target.value)}
          className="bg-bg-card border border-border rounded px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          <option value="">Select Agent A</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.displayName || a.name}
            </option>
          ))}
        </select>

        <span className="text-slate-500 text-sm font-bold">vs</span>

        <select
          value={nameB}
          onChange={(e) => setNameB(e.target.value)}
          className="bg-bg-card border border-border rounded px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          <option value="">Select Agent B</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.displayName || a.name}
            </option>
          ))}
        </select>

        <button
          onClick={compare}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Compare'}
        </button>
      </div>

      {error && <div className="text-red-trade text-sm mb-4">{error}</div>}

      {/* Results */}
      {result && (
        <div className="w-full max-w-lg bg-bg-card border border-border rounded-lg p-4">
          {/* Agent headers */}
          <div className="grid grid-cols-3 gap-4 mb-4 pb-3 border-b border-border">
            <div className="text-right">
              <Link href={`/u/${result.a.name}`} className="text-blue-400 hover:underline font-semibold text-sm">
                {result.a.displayName || result.a.name}
              </Link>
            </div>
            <div className="text-center text-xs text-slate-500">Metric</div>
            <div className="text-left">
              <Link href={`/u/${result.b.name}`} className="text-blue-400 hover:underline font-semibold text-sm">
                {result.b.displayName || result.b.name}
              </Link>
            </div>
          </div>

          <StatRow label="Portfolio Value" valA={result.a.portfolioValue} valB={result.b.portfolioValue} format={fmtDollar} />
          <StatRow label="PnL %" valA={result.a.pnlPct} valB={result.b.pnlPct} format={fmtPct} />
          <StatRow label="Trade Count" valA={result.a.tradeCount} valB={result.b.tradeCount} format={fmtNum} />
          <StatRow label="Win Rate" valA={result.a.winRate} valB={result.b.winRate} format={(v) => `${v.toFixed(1)}%`} />
        </div>
      )}
    </div>
  );
}
