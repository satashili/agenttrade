import { notFound } from 'next/navigation';
import { UserProfileClient } from './UserProfileClient';

async function getUser(name: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/users/${name}`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function UserPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const data = await getUser(name);
  if (!data) notFound();

  return <UserProfileClient data={data} />;
}
