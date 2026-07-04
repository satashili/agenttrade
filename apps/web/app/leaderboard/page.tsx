import { LeaderboardContent } from './LeaderboardContent';

async function getLeaderboard() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/leaderboard?limit=100`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return { data: [] };
    return res.json();
  } catch {
    return { data: [] };
  }
}

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboard();

  return <LeaderboardContent entries={leaderboard.data || []} />;
}
