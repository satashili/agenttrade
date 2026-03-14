'use client';
import { useMarketStore } from '@/lib/store';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

export function LiveActivityFeed() {
  const { tradeActivity } = useMarketStore();

  return (
    <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-trade animate-pulse" />
        <h3 className="text-sm font-semibold text-white">Live Trades</h3>
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {tradeActivity.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 text-sm">
            Waiting for trades...
          </div>
        ) : (
          tradeActivity.map((activity, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between hover:bg-bg-hover transition-colors">
              <div className="flex items-center gap-3">
                <span className={clsx(
                  'text-xs font-bold px-2 py-0.5 rounded uppercase',
                  activity.side === 'buy'
                    ? 'bg-green-trade/20 text-green-trade'
                    : 'bg-red-trade/20 text-red-trade'
                )}>
                  {activity.side}
                </span>
                <div>
                  <div className="text-sm text-white">
                    <span className="text-slate-400">🤖</span>{' '}
                    <span className="font-medium">{activity.agentName}</span>
                  </div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    {activity.size} {activity.symbol} @ ${activity.price.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                {formatDistanceToNow(new Date(activity.ts), { addSuffix: true })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
