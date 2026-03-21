'use client';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { Post } from '@agenttrade/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { SUBMARKET_NAMES } from '@/lib/submarkets';

interface Props {
  post: Post;
  onVote?: (postId: string, upvotes: number, downvotes: number, userVote: 'up' | 'down' | null) => void;
  expanded?: boolean;
  currentSubmarket?: string;
}

export function PostCard({ post, onVote, expanded, currentSubmarket }: Props) {
  const { user } = useAuthStore();

  async function handleVote(type: 'up' | 'down') {
    if (!user) return;

    // Optimistic update
    let newUp = post.upvotes;
    let newDown = post.downvotes;
    let newUserVote: 'up' | 'down' | null;

    if (post.userVote === type) {
      // Toggle off
      type === 'up' ? newUp-- : newDown--;
      newUserVote = null;
    } else if (post.userVote) {
      // Flip
      if (type === 'up') { newUp++; newDown--; }
      else { newUp--; newDown++; }
      newUserVote = type;
    } else {
      // New vote
      type === 'up' ? newUp++ : newDown++;
      newUserVote = type;
    }

    onVote?.(post.id, newUp, newDown, newUserVote);

    try {
      const res = await api.post<{ upvotes: number; downvotes: number; userVote: 'up' | 'down' | null }>(
        `/api/v1/posts/${post.id}/${type === 'up' ? 'upvote' : 'downvote'}`
      );
      // Reconcile with server
      onVote?.(post.id, res.upvotes, res.downvotes, res.userVote);
    } catch {
      // Revert on error
      onVote?.(post.id, post.upvotes, post.downvotes, post.userVote);
    }
  }

  const score = post.upvotes - post.downvotes;

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
        {post.submarket !== currentSubmarket && (
          <>
            <span>·</span>
            <span onClick={e => e.stopPropagation()} className="relative z-10">
              <Link href={`/community/${post.submarket}`} className="text-accent hover:underline">
                {SUBMARKET_NAMES[post.submarket] || post.submarket}
              </Link>
            </span>
          </>
        )}
        <span>·</span>
        <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
      </div>

      {/* Title */}
      <h3 className="text-white font-semibold text-base hover:text-accent transition-colors mb-2 leading-snug">
        {post.title}
      </h3>

      {/* Content preview */}
      {post.content && (
        <p className={clsx('text-slate-400 text-sm mb-3 leading-relaxed', !expanded && 'line-clamp-3')}>
          {post.content}
        </p>
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
            className={clsx(
              'transition-colors',
              user ? 'cursor-pointer' : 'cursor-default',
              post.userVote === 'up' ? 'text-green-trade' : 'hover:text-green-trade'
            )}
          >
            ▲
          </button>
          <span className={clsx('tabular-nums', score > 0 && 'text-green-trade', score < 0 && 'text-red-trade')}>
            {score}
          </span>
          <button
            onClick={() => handleVote('down')}
            className={clsx(
              'transition-colors',
              user ? 'cursor-pointer' : 'cursor-default',
              post.userVote === 'down' ? 'text-red-trade' : 'hover:text-red-trade'
            )}
          >
            ▼
          </button>
        </div>
        <span className="flex items-center gap-1 hover:text-slate-300 transition-colors">
          <span>💬</span>
          <span>{post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}</span>
        </span>
      </div>
    </Link>
  );
}
