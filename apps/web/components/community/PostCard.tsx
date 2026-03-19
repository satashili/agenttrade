'use client';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { Post } from '@agenttrade/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export function PostCard({ post, onVote, expanded }: { post: Post; onVote?: () => void; expanded?: boolean }) {
  const { user } = useAuthStore();

  async function handleVote(type: 'up' | 'down') {
    if (!user) return;
    try {
      await api.post(`/api/v1/posts/${post.id}/${type === 'up' ? 'upvote' : 'downvote'}`);
      onVote?.();
    } catch {}
  }

  return (
    <Link href={`/post/${post.id}`} className="block bg-bg-card border border-border rounded-xl p-4 hover:border-border-light transition-colors cursor-pointer">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
        <span>{post.author.type === 'agent' ? '🤖' : '👤'}</span>
        <span onClick={e => e.stopPropagation()} className="relative z-10">
          <Link href={`/u/${post.author.name}`} className="font-medium text-slate-400 hover:text-white transition-colors">
            {post.author.displayName || post.author.name}
          </Link>
        </span>
        <span>·</span>
        <span onClick={e => e.stopPropagation()} className="relative z-10">
          <Link href={`/m/${post.submarket}`} className="text-accent hover:underline">
            /m/{post.submarket}
          </Link>
        </span>
        <span>·</span>
        <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
      </div>

      {/* Title */}
      <h3 className="text-white font-semibold text-base hover:text-accent transition-colors mb-2 leading-snug">
        {post.title}
      </h3>

      {/* Content preview */}
      {post.content && (
        <>
          <p className={clsx('text-slate-400 text-sm mb-3 leading-relaxed', !expanded && 'line-clamp-2')}>
            {post.content}
          </p>
          {!expanded && post.content.length > 120 && (
            <span className="text-xs text-slate-500 -mt-2 mb-3 block">
              Show more
            </span>
          )}
        </>
      )}

      {/* Attached trade order */}
      {post.attachedOrder && (
        <div className={clsx(
          'border rounded-lg p-3 mb-3 text-sm flex items-center gap-3',
          post.attachedOrder.side === 'buy'
            ? 'border-green-trade/30 bg-green-trade/5'
            : 'border-red-trade/30 bg-red-trade/5'
        )}>
          <span className={clsx(
            'font-bold text-xs uppercase px-2 py-0.5 rounded',
            post.attachedOrder.side === 'buy'
              ? 'bg-green-trade/20 text-green-trade'
              : 'bg-red-trade/20 text-red-trade'
          )}>
            {post.attachedOrder.side}
          </span>
          <div className="flex-1 tabular-nums text-slate-300">
            {parseFloat(post.attachedOrder.size as any).toFixed(4)} {post.attachedOrder.symbol}
            {post.attachedOrder.fillPrice && (
              <span className="text-slate-500"> @ ${parseFloat(post.attachedOrder.fillPrice as any).toLocaleString()}</span>
            )}
          </div>
          <span className="text-xs text-slate-500 bg-bg-secondary px-2 py-0.5 rounded">
            ✓ Verified Trade
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => handleVote('up')}
            className={clsx('hover:text-green-trade transition-colors', user ? 'cursor-pointer' : 'cursor-default')}
          >
            ▲
          </button>
          <span className="tabular-nums">{post.upvotes - post.downvotes}</span>
          <button
            onClick={() => handleVote('down')}
            className={clsx('hover:text-red-trade transition-colors', user ? 'cursor-pointer' : 'cursor-default')}
          >
            ▼
          </button>
        </div>
        <span className="flex items-center gap-1 hover:text-slate-300 transition-colors">
          <span>💬</span>
          <span>{post.commentCount} comments</span>
        </span>
      </div>
    </Link>
  );
}
