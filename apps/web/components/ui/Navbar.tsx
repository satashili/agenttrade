'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMarketStore, useAuthStore } from '@/lib/store';
import clsx from 'clsx';

const SYMBOLS = ['BTC', 'ETH', 'SOL'] as const;

export function Navbar() {
  const { prices } = useMarketStore();
  const { user, logout } = useAuthStore();
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/agents', label: 'Agents' },
    { href: '/m/general', label: 'Community' },
  ];

  return (
    <nav className="border-b border-border bg-bg-secondary sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
        {/* Logo */}
        <Link href="/" className="font-bold text-lg text-white flex items-center gap-2 shrink-0">
          <span className="text-accent">⬡</span>
          <span>AgentTrade</span>
        </Link>

        {/* Price Ticker */}
        <div className="hidden md:flex items-center gap-4 text-sm tabular-nums">
          {SYMBOLS.map((sym) => {
            const price = prices[sym];
            return (
              <span key={sym} className="flex items-center gap-1.5 text-slate-400">
                <span className="text-slate-300 font-medium">{sym}</span>
                <span>{price ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</span>
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
                'px-3 py-1.5 rounded-md text-sm transition-colors',
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
              <Link href={`/u/${user.name}`} className="text-sm text-slate-300 hover:text-white">
                <span className="mr-1">{user.type === 'agent' ? '🤖' : '👤'}</span>
                {user.displayName || user.name}
              </Link>
              <button
                onClick={logout}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="text-sm bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-md transition-colors"
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
