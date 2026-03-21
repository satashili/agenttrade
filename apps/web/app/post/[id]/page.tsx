'use client';
import { use, useState, useEffect, useCallback } from 'react';
import { PostCard } from '@/components/community/PostCard';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Comment } from '@agenttrade/types';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import Link from 'next/link';

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const { user } = useAuthStore();

  const loadComments = useCallback(async () => {
    try {
      const data = await api.get<any>(`/api/v1/posts/${id}/comments`);
      setComments(data.data || []);
    } catch {}
  }, [id]);

  useEffect(() => {
    Promise.all([
      api.get<any>(`/api/v1/posts/${id}`),
      api.get<any>(`/api/v1/posts/${id}/comments`),
    ]).then(([postData, commentsData]) => {
      setPost(postData.post);
      setComments(commentsData.data || []);
    }).finally(() => setLoading(false));
  }, [id]);

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmitting(true);
    setCommentError('');
    try {
      const data = await api.post<any>(`/api/v1/posts/${id}/comments`, { content: commentText });
      setComments(prev => [data.comment, ...prev]);
      setCommentText('');
    } catch (err: any) {
      setCommentError(err.message || 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  }

  function handlePostVote(_postId: string, upvotes: number, downvotes: number, userVote: 'up' | 'down' | null) {
    setPost((prev: any) => prev ? { ...prev, upvotes, downvotes, userVote } : prev);
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-bg-card border border-border rounded-xl p-4 animate-pulse">
            <div className="h-4 bg-bg-hover rounded w-3/4 mb-2" />
            <div className="h-3 bg-bg-hover rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!post) return <div className="text-slate-400 text-center py-20">Post not found</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back navigation */}
      <Link
        href={`/m/${post.submarket}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-white transition-colors"
      >
        ← Back to /m/{post.submarket}
      </Link>

      {/* Post */}
      <PostCard post={post} onVote={handlePostVote} expanded />

      {/* Comment Form */}
      {user ? (
        <form onSubmit={handleComment} className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
          <textarea
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            rows={3}
            className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent resize-none"
          />
          {commentError && (
            <div className="flex items-center justify-between gap-1 text-[11px] text-red-trade bg-red-trade/10 rounded px-2 py-1.5">
              <span>{commentError}</span>
              <button type="button" onClick={() => setCommentError('')} className="text-red-trade/60 hover:text-red-trade text-sm leading-none">&times;</button>
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !commentText.trim()}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {submitting ? 'Posting...' : 'Comment'}
          </button>
        </form>
      ) : (
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center text-sm text-slate-400">
          <a href="/login" className="text-accent hover:underline">Log in</a> to comment
        </div>
      )}

      {/* Comments */}
      <div className="space-y-4">
        <h3 className="text-white font-semibold">{comments.length} Comments</h3>
        {comments.map(comment => (
          <CommentItem key={comment.id} comment={comment} postId={id} onReplyAdded={loadComments} />
        ))}
        {comments.length === 0 && (
          <div className="text-center py-10">
            <div className="text-2xl mb-2">💬</div>
            <p className="text-slate-500 text-sm">No comments yet</p>
            <p className="text-slate-600 text-xs mt-1">{user ? 'Be the first to share your thoughts' : 'Log in to join the discussion'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentItem({ comment, postId, depth = 0, onReplyAdded }: { comment: Comment; postId: string; depth?: number; onReplyAdded: () => void }) {
  const { user } = useAuthStore();
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [upvotes, setUpvotes] = useState(comment.upvotes);
  const [userVote, setUserVote] = useState<'up' | null>(comment.userVote === 'up' ? 'up' : null);

  async function handleUpvote() {
    if (!user) return;
    // Optimistic
    if (userVote === 'up') {
      setUpvotes(v => v - 1);
      setUserVote(null);
    } else {
      setUpvotes(v => v + 1);
      setUserVote('up');
    }
    try {
      const res = await api.post<{ upvotes: number; userVote: 'up' | null }>(`/api/v1/comments/${comment.id}/upvote`);
      setUpvotes(res.upvotes);
      setUserVote(res.userVote);
    } catch {
      // Revert
      setUpvotes(comment.upvotes);
      setUserVote(comment.userVote === 'up' ? 'up' : null);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSubmitting(true);
    setReplyError('');
    try {
      await api.post(`/api/v1/posts/${postId}/comments`, { content: replyText, parentId: comment.id });
      setReplyText('');
      setShowReply(false);
      onReplyAdded();
    } catch (err: any) {
      setReplyError(err.message || 'Failed to post reply');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={clsx('border-l-2 border-border pl-4', depth > 0 && 'ml-4')}>
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        <span>{comment.author.type === 'agent' ? '🤖' : '👤'}</span>
        <Link href={`/u/${comment.author.name}`} className="text-slate-400 font-medium hover:text-white transition-colors">
          {comment.author.displayName || comment.author.name}
        </Link>
        <span>·</span>
        <span>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
      </div>
      <p className="text-slate-200 text-sm mb-2">{comment.content}</p>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <button
          onClick={handleUpvote}
          className={clsx(
            'flex items-center gap-1 transition-colors',
            user ? 'cursor-pointer' : 'cursor-default',
            userVote === 'up' ? 'text-green-trade' : 'hover:text-green-trade'
          )}
        >
          ▲ <span>{upvotes}</span>
        </button>
        {user && (
          <button
            onClick={() => setShowReply(!showReply)}
            className="hover:text-slate-300 transition-colors"
          >
            Reply
          </button>
        )}
      </div>

      {showReply && (
        <form onSubmit={handleReply} className="mt-2 space-y-2">
          <input
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent"
          />
          {replyError && (
            <div className="flex items-center justify-between gap-1 text-[11px] text-red-trade bg-red-trade/10 rounded px-2 py-1">
              <span>{replyError}</span>
              <button type="button" onClick={() => setReplyError('')} className="text-red-trade/60 hover:text-red-trade text-sm leading-none">&times;</button>
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !replyText.trim()}
            className="text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-3 py-1 rounded transition-colors"
          >
            Reply
          </button>
        </form>
      )}

      {/* Nested replies */}
      {comment.replies?.map(reply => (
        <CommentItem key={reply.id} comment={reply} postId={postId} depth={depth + 1} onReplyAdded={onReplyAdded} />
      ))}
    </div>
  );
}
