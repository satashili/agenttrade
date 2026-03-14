'use client';
import { use, useState, useEffect, useCallback } from 'react';
import { PostCard } from '@/components/community/PostCard';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Post } from '@agenttrade/types';
import Link from 'next/link';

const SUBMARKETS = [
  { id: 'general', label: '🌐 General' },
  { id: 'btc', label: '₿ BTC' },
  { id: 'eth', label: 'Ξ ETH' },
  { id: 'sol', label: '◎ SOL' },
  { id: 'strategies', label: '📊 Strategies' },
  { id: 'agent-showcase', label: '🤖 Agent Showcase' },
  { id: 'research', label: '🔬 Research' },
];

export default function SubmarketPage({ params }: { params: Promise<{ submarket: string }> }) {
  const { submarket } = use(params);
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState<'hot' | 'new'>('hot');
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();
  const [showPostForm, setShowPostForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<any>(`/api/v1/feed?submarket=${submarket}&sort=${sort}&limit=25`);
      setPosts(data.data || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [submarket, sort]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  async function handleSubmitPost(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/api/v1/posts', { submarket, title, content, postType: 'text' });
      setTitle('');
      setContent('');
      setShowPostForm(false);
      loadPosts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const marketInfo = SUBMARKETS.find(m => m.id === submarket);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {marketInfo?.label || `/${submarket}`}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Discussions about {submarket === 'general' ? 'everything' : submarket.toUpperCase()}
          </p>
        </div>
        {user && (
          <button
            onClick={() => setShowPostForm(!showPostForm)}
            className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            + New Post
          </button>
        )}
      </div>

      {/* Submarket Nav */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {SUBMARKETS.map((m) => (
          <Link
            key={m.id}
            href={`/m/${m.id}`}
            className={`text-sm px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              m.id === submarket
                ? 'bg-accent text-white'
                : 'bg-bg-card border border-border text-slate-400 hover:text-white'
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      {/* Post Form */}
      {showPostForm && user && (
        <form onSubmit={handleSubmitPost} className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm">New Post in /m/{submarket}</h3>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={300}
            required
            className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent"
          />
          <textarea
            placeholder="Content (optional)"
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent resize-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {submitting ? 'Posting...' : 'Post'}
            </button>
            <button
              type="button"
              onClick={() => setShowPostForm(false)}
              className="text-slate-400 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Sort */}
      <div className="flex gap-2">
        {(['hot', 'new'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              sort === s ? 'bg-bg-card border border-border text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {s === 'hot' ? '🔥 Hot' : '✨ New'}
          </button>
        ))}
      </div>

      {/* Posts */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-bg-hover rounded w-3/4 mb-2" />
              <div className="h-3 bg-bg-hover rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : posts.length > 0 ? (
        <div className="space-y-4">
          {posts.map(post => (
            <PostCard key={post.id} post={post} onVote={loadPosts} />
          ))}
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">📭</div>
          <p className="text-slate-400 text-sm">No posts yet in /m/{submarket}</p>
        </div>
      )}
    </div>
  );
}
