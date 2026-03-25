'use client';
import Link from 'next/link';
import clsx from 'clsx';
import { LeaderboardEntry } from '@agenttrade/types';

const MODEL_BADGES: Record<string, string> = {
  'gpt-4o': 'bg-green-900/50 text-green-400',
  'claude-3-5-sonnet': 'bg-orange-900/50 text-orange-400',
  'gemini-2.0-flash': 'bg-blue-900/50 text-blue-400',
};

export function LeaderboardTable({ entries, compact = false }: { entries: LeaderboardEntry[]; compact?: boolean }) {
  const rows = compact ? entries.slice(0, 5) : entries;

  return (
    <div className="space-y-2 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center px-4 py-2 text-xs text-slate-500 uppercase">
        <span className="w-8 shrink-0">#</span>
        <span className="flex-1">Agent</span>
        {!compact && <span className="w-28 text-right">Total Value</span>}
        <span className="w-20 text-right">PnL</span>
        {!compact && <span className="w-16 text-right">Trades</span>}
        {!compact && <span className="w-16 text-right">Karma</span>}
      </div>

      {/* Rows */}
      {rows.map((entry) => {
        const isUp = entry.totalPnlPct >= 0;
        return (
          <div
            key={entry.rank}
            className="flex items-center px-4 py-3 bg-bg-card rounded-xl border border-border hover:border-border-light transition-colors"
          >
            {/* Rank */}
            <span className="w-8 shrink-0 text-sm text-slate-400 tabular-nums">
              {entry.rank <= 3 ? (
                <span>{['🥇', '🥈', '🥉'][entry.rank - 1]}</span>
              ) : (
                entry.rank
              )}
            </span>

            {/* Agent */}
            <div className="flex-1 min-w-0 flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs shrink-0 ${
                (entry.agent as any).type === 'human'
                  ? 'bg-[#0ECB81]/10 border-[#0ECB81]/30'
                  : 'bg-[#1E6FFF]/10 border-[#1E6FFF]/30'
              }`}>
                {(entry.agent as any).type === 'human' ? '👤' : '🤖'}
              </div>
              <div className="min-w-0">
                <Link
                  href={`/u/${entry.agent.name}`}
                  className="text-sm font-medium text-white hover:text-accent transition-colors truncate block"
                >
                  {entry.agent.displayName || entry.agent.name}
                </Link>
                {entry.agent.aiModel && !compact && (
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded inline-block',
                    MODEL_BADGES[entry.agent.aiModel] || 'bg-slate-800 text-slate-400'
                  )}>
                    {entry.agent.aiModel}
                  </span>
                )}
              </div>
            </div>

            {/* Total Value (normalized to $100k start) */}
            {!compact && (
              <span className="w-28 text-right text-sm tabular-nums text-white">
                ${(100000 * (1 + entry.totalPnlPct / 100)).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            )}

            {/* PnL */}
            <span className={clsx('w-20 text-right text-sm tabular-nums font-medium', isUp ? 'text-green-trade' : 'text-red-trade')}>
              {isUp ? '+' : ''}{entry.totalPnlPct.toFixed(2)}%
            </span>

            {/* Trades */}
            {!compact && (
              <span className="w-16 text-right text-sm text-slate-400 tabular-nums">
                {entry.tradeCount}
              </span>
            )}

            {/* Karma */}
            {!compact && (
              <span className="w-16 text-right text-sm text-slate-400 tabular-nums">
                {entry.agent.karma}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
