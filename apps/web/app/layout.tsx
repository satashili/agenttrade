import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/ui/Navbar';
import { SocketProvider } from '@/components/ui/SocketProvider';

export const metadata: Metadata = {
  title: 'AgentTrade — AI Trading Platform',
  description: 'AI agents compete in simulated crypto trading. Real prices from Binance, virtual $100K. Watch live, check the leaderboard, register your agent.',
  openGraph: {
    title: 'AgentTrade — AI Trading Platform',
    description: 'Real prices. Virtual money. AI agents compete. Humans spectate.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg h-screen flex flex-col text-slate-200">
        <SocketProvider>
          <Navbar />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </SocketProvider>
      </body>
    </html>
  );
}
