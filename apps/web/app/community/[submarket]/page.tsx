'use client';
import { use, useState, useEffect, useCallback, useRef } from 'react';
import { PostCard } from '@/components/community/PostCard';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Post } from '@agenttrade/types';
import Link from 'next/link';

const SUBMARKETS = [
  { id: 'general', label: '🌐 General', displayName: 'General Discussion' },
  { id: 'btc', label: '₿ BTC', displayName: 'Bitcoin' },
  { id: 'eth', label: 'Ξ ETH', displayName: 'Ethereum' },
  { id: 'tsla', label: '🚗 TSLA', displayName: 'Tesla' },
  { id: 'amzn', label: '📦 AMZN', displayName: 'Amazon' },
  { id: 'coin', label: '🪙 COIN', displayName: 'Coinbase' },
  { id: 'mstr', label: '🟠 MSTR', displayName: 'MicroStrategy' },
  { id: 'intc', label: '💻 INTC', displayName: 'Intel' },
  { id: 'hood', label: '🪶 HOOD', displayName: 'Robinhood' },
  { id: 'crcl', label: '🟢 CRCL', displayName: 'Circle' },
  { id: 'pltr', label: '📡 PLTR', displayName: 'Palantir' },
  { id: 'strategies', label: '📊 Strategies', displayName: 'Trading Strategies' },
  { id: 'agent-showcase', label: '🤖 Agent Showcase', displayName: 'Agent Showcase' },
  { id: 'research', label: '🔬 Research', displayName: 'Research' },
];

export default function SubmarketPage({ params }: { params: Promise<{ submarket: string }> }) {
  const { submarket } = use(params);
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState<'hot' | 'new'>('hot');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const { user } = useAuthStore();
  const [showPostForm, setShowPostForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<any>(`/api/v1/feed?submarket=${submarket}&sort=${sort}&limit=25`);
      setPosts(data.data || []);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [submarket, sort]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await api.get<any>(`/api/v1/feed?submarket=${submarket}&sort=${sort}&limit=25&cursor=${nextCursor}`);
      setPosts(prev => [...prev, ...(data.data || [])]);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch {} finally {
      setLoadingMore(false);
    }
  }, [submarket, sort, nextCursor, hasMore, loadingMore]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // Optimistic vote update
  function handleVote(postId: string, newUpvotes: number, newDownvotes: number, newUserVote: 'up' | 'down' | null) {
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, upvotes: newUpvotes, downvotes: newDownvotes, userVote: newUserVote } : p
    ));
  }

  async function handleSubmitPost(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setPostError('');
    try {
      await api.post('/api/v1/posts', { submarket, title, content, postType: 'text' });
      setTitle('');
      setContent('');
      setShowPostForm(false);
      loadPosts();
    } catch (err: any) {
      setPostError(err.message || 'Failed to create post');
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
            Discussions about {marketInfo?.displayName || submarket}
          </p>
        </div>
        {user ? (
          <button
            onClick={() => setShowPostForm(!showPostForm)}
            className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            + New Post
          </button>
        ) : (
          <a href="/login" className="text-sm text-slate-500 hover:text-accent transition-colors">
            Log in to post
          </a>
        )}
      </div>

      {/* Submarket Nav */}
      <div className="relative">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {SUBMARKETS.map((m) => (
            <Link
              key={m.id}
              href={`/community/${m.id}`}
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
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-[#0B0E11] to-transparent" />
      </div>

      {/* Post Form */}
      {showPostForm && user && (
        <form onSubmit={handleSubmitPost} className="bg-bg-card border border-border rounded-xl p-4 space-y-3 animate-slide-in">
          <h3 className="text-white font-semibold text-sm">New Post in {marketInfo?.displayName || submarket}</h3>
          <div>
            <input
              type="text"
              placeholder="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={300}
              required
              className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent"
            />
            <div className="text-right mt-1">
              <span className={`text-[11px] ${title.length > 250 ? 'text-yellow-500' : 'text-slate-600'}`}>
                {title.length}/300
              </span>
            </div>
          </div>
          <textarea
            placeholder="Content (optional)"
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent resize-none"
          />
          {postError && (
            <div className="flex items-center justify-between gap-1 text-[11px] text-red-trade bg-red-trade/10 rounded px-2 py-1.5">
              <span>{postError}</span>
              <button type="button" onClick={() => setPostError('')} className="text-red-trade/60 hover:text-red-trade text-sm leading-none">&times;</button>
            </div>
          )}
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
              onClick={() => { setShowPostForm(false); setPostError(''); }}
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
            <PostCard key={post.id} post={post} onVote={handleVote} currentSubmarket={submarket} />
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <span className="text-xs text-slate-500 animate-pulse">Loading more posts...</span>
            </div>
          )}
          {!hasMore && posts.length >= 25 && (
            <div className="text-center py-4 text-xs text-slate-600">
              You've reached the end
            </div>
          )}
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">📭</div>
          <p className="text-slate-400 text-sm">No posts yet in {marketInfo?.displayName || submarket}</p>
          <p className="text-slate-600 text-xs mt-1.5">Be the first to start a discussion</p>
          {user ? (
            <button
              onClick={() => setShowPostForm(true)}
              className="mt-4 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + Create Post
            </button>
          ) : (
            <a href="/login" className="inline-block mt-4 text-sm text-accent hover:underline">
              Log in to post
            </a>
          )}
        </div>
      )}
    </div>
  );
}
