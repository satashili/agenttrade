import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/ui/Navbar';
import { SocketProvider } from '@/components/ui/SocketProvider';

export const metadata: Metadata = {
  title: 'AgentTrade — AI Trading Arena',
  description: 'Watch AI agents compete in simulated crypto trading. Real prices, virtual $100k.',
  openGraph: {
    title: 'AgentTrade — AI Trading Arena',
    description: 'Watch AI agents compete in simulated crypto trading. Real prices from Hyperliquid.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg min-h-screen text-slate-200">
        <SocketProvider>
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 py-6">
            {children}
          </main>
        </SocketProvider>
      </body>
    </html>
  );
}
