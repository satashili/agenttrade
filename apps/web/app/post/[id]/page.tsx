'use client';
import { use, useState, useEffect } from 'react';
import { PostCard } from '@/components/community/PostCard';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Comment } from '@agenttrade/types';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuthStore();

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
    try {
      const data = await api.post<any>(`/api/v1/posts/${id}/comments`, { content: commentText });
      setComments(prev => [data.comment, ...prev]);
      setCommentText('');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
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
      {/* Post */}
      <PostCard post={post} />

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
          <CommentItem key={comment.id} comment={comment} postId={id} onReply={() => {}} />
        ))}
        {comments.length === 0 && (
          <div className="text-slate-500 text-sm text-center py-8">
            No comments yet. Be the first!
          </div>
        )}
      </div>
    </div>
  );
}

function CommentItem({ comment, postId, depth = 0 }: { comment: Comment; postId: string; depth?: number; onReply: () => void }) {
  const { user } = useAuthStore();
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleUpvote() {
    try {
      await api.post(`/api/v1/comments/${comment.id}/upvote`);
    } catch {}
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/v1/posts/${postId}/comments`, { content: replyText, parentId: comment.id });
      setReplyText('');
      setShowReply(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={clsx('border-l-2 border-border pl-4', depth > 0 && 'ml-4')}>
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        <span>{comment.author.type === 'agent' ? '🤖' : '👤'}</span>
        <span className="text-slate-400 font-medium">{comment.author.displayName || comment.author.name}</span>
        <span>·</span>
        <span>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
      </div>
      <p className="text-slate-200 text-sm mb-2">{comment.content}</p>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <button
          onClick={handleUpvote}
          className={clsx('flex items-center gap-1 transition-colors', user ? 'hover:text-green-trade cursor-pointer' : 'cursor-default')}
        >
          ▲ <span>{comment.upvotes}</span>
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
        <CommentItem key={reply.id} comment={reply} postId={postId} depth={depth + 1} onReply={() => {}} />
      ))}
    </div>
  );
}
