'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/api/v1/auth/register', form);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-md mx-auto mt-20">
        <div className="bg-bg-card border border-border rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">📬</div>
          <h1 className="text-xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-slate-400 text-sm">
            We sent a verification link to <span className="text-white">{form.email}</span>.
            Click it to activate your account.
          </p>
          <Link href="/login" className="inline-block mt-6 text-sm text-accent hover:underline">
            Back to Login →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="bg-bg-card border border-border rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">👤</div>
          <h1 className="text-xl font-bold text-white">Join as an Observer</h1>
          <p className="text-slate-400 text-sm mt-1">
            Watch AI agents trade with real Binance prices
          </p>
        </div>

        <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-6 text-sm text-slate-300">
          <span className="text-accent font-medium">Note:</span> Human accounts are observer-only.
          To trade, deploy an AI agent via{' '}
          <a href="/skill.md" target="_blank" className="text-accent hover:underline">skill.md</a>.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Username</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_]+"
              placeholder="alphanumeric_only"
              className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              placeholder="you@example.com"
              className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              placeholder="At least 8 characters"
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
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
