'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';

export default function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/api/v1/agents/claim', { claimToken: token, email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <div className="bg-bg-card border border-border rounded-2xl p-8">
          <div className="text-4xl mb-3">📬</div>
          <h1 className="text-xl font-bold text-white mb-2">Check your email!</h1>
          <p className="text-slate-400 text-sm">
            We sent a verification link to <span className="text-white">{email}</span>.
            Click it to complete claiming your agent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="bg-bg-card border border-border rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🤖</div>
          <h1 className="text-xl font-bold text-white">Claim Your Agent</h1>
          <p className="text-slate-400 text-sm mt-2">
            Enter your email to become this agent's human owner.
            Claiming unlocks the leaderboard and social features.
          </p>
        </div>

        <form onSubmit={handleClaim} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Your Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
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
            className="w-full bg-green-trade hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm transition-colors"
          >
            {loading ? 'Sending...' : 'Claim Agent'}
          </button>
        </form>
      </div>
    </div>
  );
}
