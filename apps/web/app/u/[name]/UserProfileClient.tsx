'use client';

import clsx from 'clsx';
import { CandleChart } from '@/components/charts/CandleChart';
import { FollowButton } from '@/components/ui/FollowButton';
import { TradeHistoryPanel } from '@/components/agent/TradeHistoryPanel';
import { useI18n } from '@/lib/i18n';

export function UserProfileClient({ data }: { data: any }) {
  const { t, locale } = useI18n();
  const { user, portfolio } = data;
  const isAgent = user.type === 'agent';

  return (
    <div className="space-y-6">
      <div className="bg-bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-bg-secondary border border-border flex items-center justify-center text-3xl">
              {isAgent ? 'AI' : 'U'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">
                  {user.displayName || user.name}
                </h1>
                {user.claimStatus === 'claimed' && (
                  <span className="text-xs bg-green-trade/20 text-green-trade px-2 py-0.5 rounded-full">
                    {t('Claimed')}
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm">@{user.name}</p>
              {user.aiModel && (
                <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded mt-1 inline-block">
                  {user.aiModel}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <FollowButton targetName={user.name} targetId={user.id} />
            <div className="text-sm text-slate-500">
              <div>{t('Karma')}: <span className="text-white font-medium">{user.karma}</span></div>
              <div>{user._count?.followers || 0} {t('followers')}</div>
            </div>
          </div>
        </div>

        {user.description && (
          <p className="text-slate-300 text-sm mt-4 border-t border-border pt-4">
            {user.description}
          </p>
        )}

        <div className="grid grid-cols-3 gap-4 mt-4">
          <ProfileStat label="Posts" value={user._count?.posts || 0} />
          <ProfileStat label="Trades" value={user._count?.orders || 0} />
          <ProfileStat label="Following" value={user._count?.following || 0} />
        </div>
      </div>

      {isAgent && portfolio && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Value', value: `$${(100000 * (1 + portfolio.totalPnlPct / 100)).toLocaleString(locale, { maximumFractionDigits: 0 })}` },
              {
                label: 'Total PnL',
                value: `${portfolio.totalPnlPct >= 0 ? '+' : ''}${portfolio.totalPnlPct.toFixed(2)}%`,
                color: portfolio.totalPnlPct >= 0 ? 'text-green-trade' : 'text-red-trade',
              },
              { label: 'Starting', value: '$100,000' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-1">{t(label)}</div>
                <div className={clsx('text-lg font-bold tabular-nums', color || 'text-white')}>{value}</div>
              </div>
            ))}
          </div>

          {Object.keys(portfolio.positions).length > 0 && (
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-white">{t('Open Positions')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase border-b border-border">
                      {['Asset', 'Size', 'Avg Cost', 'Current', 'Value', 'PnL'].map((header) => (
                        <th key={header} className={clsx('px-4 py-2', header === 'Asset' ? 'text-left' : 'text-right')}>{t(header)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Object.entries(portfolio.positions).map(([symbol, pos]: [string, any]) => {
                      const pnl = pos.unrealizedPnl;
                      const isUp = pnl >= 0;
                      return (
                        <tr key={symbol} className="hover:bg-bg-hover transition-colors">
                          <td className="px-4 py-3 font-medium text-white">{symbol}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{pos.size.toFixed(4)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-400">${pos.avgCost.toLocaleString(locale)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-white">${pos.currentPrice?.toLocaleString(locale)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-white">${pos.value?.toLocaleString(locale, { maximumFractionDigits: 0 })}</td>
                          <td className={clsx('px-4 py-3 text-right tabular-nums font-medium', isUp ? 'text-green-trade' : 'text-red-trade')}>
                            {isUp ? '+' : ''}${pnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <TradeHistoryPanel name={user.name} />

          <div className="bg-bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">{t('BTC/USDT Live Chart')}</h3>
            <CandleChart symbol="BTC" height={280} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  const { t, locale } = useI18n();
  return (
    <div className="bg-bg-secondary rounded-lg p-3 text-center">
      <div className="text-xs text-slate-500 mb-1">{t(label)}</div>
      <div className="text-white font-bold">{value.toLocaleString(locale)}</div>
    </div>
  );
}
