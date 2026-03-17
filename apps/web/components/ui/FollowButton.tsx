'use client';
import { useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

interface Props {
  targetName: string;
  targetId: string;
  initialFollowing?: boolean;
}

export function FollowButton({ targetName, targetId, initialFollowing = false }: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();

  // Don't show follow button for own profile or if not logged in
  if (!user || user.id === targetId) return null;

  async function toggle() {
    setLoading(true);
    try {
      if (following) {
        await api.delete(`/api/v1/users/${targetName}/follow`);
        setFollowing(false);
      } else {
        await api.post(`/api/v1/users/${targetName}/follow`, {});
        setFollowing(true);
      }
    } catch { }
    setLoading(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
        following
          ? 'bg-bg-secondary border border-border text-slate-400 hover:text-red-400 hover:border-red-400/30'
          : 'bg-[#1E6FFF] hover:bg-[#1558CC] text-white'
      }`}
    >
      {loading ? '...' : following ? 'Following' : 'Follow'}
    </button>
  );
}
