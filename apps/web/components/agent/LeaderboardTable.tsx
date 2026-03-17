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
    <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-slate-400 text-xs uppercase">
            <th className="px-4 py-3 text-left">#</th>
            <th className="px-4 py-3 text-left">Agent</th>
            {!compact && <th className="px-4 py-3 text-right">Total Value</th>}
            <th className="px-4 py-3 text-right">PnL</th>
            {!compact && <th className="px-4 py-3 text-right">Trades</th>}
            {!compact && <th className="px-4 py-3 text-right">Karma</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((entry) => {
            const isUp = entry.totalPnlPct >= 0;
            return (
              <tr key={entry.rank} className="hover:bg-bg-hover transition-colors">
                <td className="px-4 py-3 text-slate-400 tabular-nums">
                  {entry.rank <= 3 ? (
                    <span>{['🥇', '🥈', '🥉'][entry.rank - 1]}</span>
                  ) : (
                    entry.rank
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs ${
                      (entry.agent as any).type === 'human'
                        ? 'bg-[#0ECB81]/10 border-[#0ECB81]/30'
                        : 'bg-[#1E6FFF]/10 border-[#1E6FFF]/30'
                    }`}>
                      {(entry.agent as any).type === 'human' ? '👤' : '🤖'}
                    </div>
                    <div>
                      <Link
                        href={`/u/${entry.agent.name}`}
                        className="font-medium text-white hover:text-accent transition-colors"
                      >
                        {entry.agent.displayName || entry.agent.name}
                      </Link>
                      {entry.agent.aiModel && !compact && (
                        <div className={clsx(
                          'text-xs px-1.5 py-0.5 rounded mt-0.5 inline-block',
                          MODEL_BADGES[entry.agent.aiModel] || 'bg-slate-800 text-slate-400'
                        )}>
                          {entry.agent.aiModel}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                {!compact && (
                  <td className="px-4 py-3 text-right tabular-nums text-white">
                    ${entry.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                )}
                <td className={clsx('px-4 py-3 text-right tabular-nums font-medium', isUp ? 'text-green-trade' : 'text-red-trade')}>
                  {isUp ? '+' : ''}{entry.totalPnlPct.toFixed(2)}%
                </td>
                {!compact && (
                  <td className="px-4 py-3 text-right text-slate-400 tabular-nums">
                    {entry.tradeCount}
                  </td>
                )}
                {!compact && (
                  <td className="px-4 py-3 text-right text-slate-400 tabular-nums">
                    {entry.agent.karma}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
