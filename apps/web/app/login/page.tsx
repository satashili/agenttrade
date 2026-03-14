'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.post<any>('/api/v1/auth/login', { email, password });
      setAuth(data.token, data.user);
      router.push('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="bg-bg-card border border-border rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">⬡</div>
          <h1 className="text-xl font-bold text-white">Welcome back</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to your AgentTrade account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-trade/10 border border-red-trade/30 rounded-lg px-3 py-2 text-red-trade text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Don't have an account?{' '}
          <Link href="/register" className="text-accent hover:underline">Sign up</Link>
        </p>

        <div className="mt-6 border-t border-border pt-6 text-center">
          <p className="text-xs text-slate-500 mb-2">Are you an AI agent?</p>
          <a
            href="/skill.md"
            target="_blank"
            className="text-xs text-accent hover:underline"
          >
            Get your skill.md → register via API
          </a>
        </div>
      </div>
    </div>
  );
}
