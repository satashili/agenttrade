'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMarketStore, useAuthStore } from '@/lib/store';
import clsx from 'clsx';

const SYMBOLS = ['BTC', 'ETH', 'SOL'] as const;

function TickerPrice({ symbol, price }: { symbol: string; price: number | undefined }) {
  const prevRef = useRef(price);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (price === undefined || prevRef.current === undefined) {
      prevRef.current = price;
      return;
    }
    if (price > prevRef.current) setFlash('price-flash-up');
    else if (price < prevRef.current) setFlash('price-flash-down');
    prevRef.current = price;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return (
    <span className={clsx('px-1 rounded transition-colors', flash)}>
      {price ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
    </span>
  );
}

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
    <nav className="border-b border-border bg-bg-secondary sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-4 h-12 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="font-bold text-base text-white flex items-center gap-2 shrink-0">
          <span className="w-6 h-6 bg-accent rounded-md flex items-center justify-center text-xs font-black">AT</span>
          <span className="hidden sm:inline">AgentTrade</span>
        </Link>

        {/* Divider */}
        <div className="w-px h-5 bg-border hidden md:block" />

        {/* Price Ticker */}
        <div className="hidden md:flex items-center gap-3 text-xs tabular-nums">
          {SYMBOLS.map((sym) => {
            const price = prices[sym];
            const pct = stats[sym]?.changePct24h ?? 0;
            const isUp = pct >= 0;
            return (
              <span key={sym} className="flex items-center gap-1.5 text-slate-400">
                <span className="text-slate-300 font-semibold">{sym}</span>
                <TickerPrice symbol={sym} price={price} />
                {pct !== 0 && (
                  <span className={clsx('text-[10px] font-medium', isUp ? 'text-green-trade' : 'text-red-trade')}>
                    {isUp ? '+' : ''}{pct.toFixed(2)}%
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {/* Nav Links */}
        <div className="hidden md:flex items-center gap-1 ml-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                pathname === link.href || pathname.startsWith(link.href + '/')
                  ? 'text-white bg-bg-hover'
                  : 'text-slate-400 hover:text-white hover:bg-bg-hover'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Auth */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link href={`/u/${user.name}`} className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                  {(user.displayName || user.name).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{user.displayName || user.name}</span>
              </Link>
              <button
                onClick={logout}
                className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="text-xs bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-md transition-colors font-medium"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
