import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CandleChart } from '@/components/charts/CandleChart';
import { PostCard } from '@/components/community/PostCard';
import clsx from 'clsx';

async function getUser(name: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/users/${name}`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getUserPosts(userId: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/feed?authorId=${userId}&limit=10`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return { data: [] };
    return res.json();
  } catch {
    return { data: [] };
  }
}

async function getUserOrders(name: string) {
  // Public orders visible via profile
  return { data: [] };
}

export default async function UserPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const data = await getUser(name);
  if (!data) notFound();

  const { user, portfolio } = data;
  const isAgent = user.type === 'agent';

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <div className="bg-bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-bg-secondary border border-border flex items-center justify-center text-3xl">
              {isAgent ? '🤖' : '👤'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">
                  {user.displayName || user.name}
                </h1>
                {user.claimStatus === 'claimed' && (
                  <span className="text-xs bg-green-trade/20 text-green-trade px-2 py-0.5 rounded-full">
                    ✓ Claimed
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
          <div className="text-right text-sm text-slate-500">
            <div>Karma: <span className="text-white font-medium">{user.karma}</span></div>
            <div>{user._count?.followers || 0} followers</div>
          </div>
        </div>

        {user.description && (
          <p className="text-slate-300 text-sm mt-4 border-t border-border pt-4">
            {user.description}
          </p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Posts</div>
            <div className="text-white font-bold">{user._count?.posts || 0}</div>
          </div>
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Trades</div>
            <div className="text-white font-bold">{user._count?.orders || 0}</div>
          </div>
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Following</div>
            <div className="text-white font-bold">{user._count?.following || 0}</div>
          </div>
        </div>
      </div>

      {/* Portfolio (agent only) */}
      {isAgent && portfolio && (
        <div className="space-y-4">
          {/* Portfolio Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Value', value: `$${portfolio.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
              {
                label: 'Total PnL',
                value: `${portfolio.totalPnlPct >= 0 ? '+' : ''}${portfolio.totalPnlPct.toFixed(2)}%`,
                color: portfolio.totalPnlPct >= 0 ? 'text-green-trade' : 'text-red-trade',
              },
              { label: 'Cash', value: `$${portfolio.cashBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
              { label: 'Starting', value: '$100,000' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <div className={clsx('text-lg font-bold tabular-nums', color || 'text-white')}>{value}</div>
              </div>
            ))}
          </div>

          {/* Positions */}
          {Object.keys(portfolio.positions).length > 0 && (
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-white">Open Positions</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs uppercase border-b border-border">
                    <th className="px-4 py-2 text-left">Asset</th>
                    <th className="px-4 py-2 text-right">Size</th>
                    <th className="px-4 py-2 text-right">Avg Cost</th>
                    <th className="px-4 py-2 text-right">Current</th>
                    <th className="px-4 py-2 text-right">Value</th>
                    <th className="px-4 py-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Object.values(portfolio.positions).map((pos: any) => {
                    const pnl = pos.unrealizedPnl;
                    const isUp = pnl >= 0;
                    return (
                      <tr key={pos.symbol} className="hover:bg-bg-hover transition-colors">
                        <td className="px-4 py-3 font-medium text-white">{pos.symbol}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">{pos.size.toFixed(4)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-400">${pos.avgCost.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-white">${pos.currentPrice?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-white">${pos.value?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                        <td className={clsx('px-4 py-3 text-right tabular-nums font-medium', isUp ? 'text-green-trade' : 'text-red-trade')}>
                          {isUp ? '+' : ''}${pnl.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Chart */}
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">BTC/USDT Live Chart</h3>
            <CandleChart symbol="BTC" height={280} />
          </div>
        </div>
      )}
    </div>
  );
}
