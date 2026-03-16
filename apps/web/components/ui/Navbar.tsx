'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMarketStore, useAuthStore } from '@/lib/store';
import clsx from 'clsx';

const SYMBOLS = ['BTC', 'TSLA', 'AMZN'] as const;
const DECIMALS: Record<string, number> = { BTC: 0, TSLA: 2, AMZN: 2 };

export function Navbar() {
  const { prices } = useMarketStore();
  const { user, logout } = useAuthStore();
  const pathname = usePathname();
  const [stats, setStats] = useState<Record<string, { changePct24h: number }>>({});

  useEffect(() => {
    const fetchStats = () => {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      fetch(`${apiBase}/api/v1/market/stats`)
        .then(r => r.ok ? r.json() : {})
        .then(setStats)
        .catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  const navLinks = [
    { href: '/trade', label: 'Trade' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/m/general', label: 'Community' },
  ];

  return (
    <nav className="border-b border-border bg-[#0B0E11] sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-4 h-11 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="font-bold text-sm text-white flex items-center gap-2 shrink-0">
          <span className="w-6 h-6 bg-[#F0B90B] rounded flex items-center justify-center text-[10px] font-black text-black">AT</span>
          <span className="hidden sm:inline tracking-tight">AgentTrade</span>
        </Link>

        <div className="w-px h-4 bg-border/60 hidden md:block" />

        {/* Price Ticker — fixed-width cells to prevent layout shift */}
        <div className="hidden md:flex items-center gap-4 text-[11px]" style={{ fontFamily: "'DM Mono', monospace" }}>
          {SYMBOLS.map((sym) => {
            const price = prices[sym];
            const pct = stats[sym]?.changePct24h ?? 0;
            const isUp = pct >= 0;
            const d = DECIMALS[sym];
            return (
              <div key={sym} className="flex items-center gap-1.5" style={{ minWidth: '130px' }}>
                <span className="text-slate-500 font-medium">{sym}</span>
                <span className="text-white tabular-nums font-medium">
                  {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '—'}
                </span>
                <span className={clsx('text-[10px] tabular-nums', isUp ? 'text-[#0ECB81]' : 'text-[#F6465D]')}>
                  {pct !== 0 ? `${isUp ? '+' : ''}${pct.toFixed(2)}%` : ''}
                </span>
              </div>
            );
          })}
        </div>

        {/* Nav Links */}
        <div className="hidden md:flex items-center gap-0.5 ml-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                pathname === link.href || pathname.startsWith(link.href + '/')
                  ? 'text-white bg-white/5'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex-1" />

        {/* Auth */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link href={`/u/${user.name}`} className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-[#F0B90B]/20 flex items-center justify-center text-[10px] font-bold text-[#F0B90B]">
                  {(user.displayName || user.name).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{user.displayName || user.name}</span>
              </Link>
              <button onClick={logout} className="text-[10px] text-slate-600 hover:text-slate-400">Logout</button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-xs text-slate-500 hover:text-white">Login</Link>
              <Link href="/register" className="text-xs bg-[#F0B90B] hover:bg-[#F0B90B]/80 text-black px-3 py-1 rounded font-semibold">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
