import AiAgentsClient, { type FleetData } from './AiAgentsClient';

async function getFleet(): Promise<FleetData | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/ai-agents/fleet`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function AiAgentsPage() {
  const initialFleet = await getFleet();

  return <AiAgentsClient initialFleet={initialFleet} />;
}
