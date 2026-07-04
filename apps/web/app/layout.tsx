import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/ui/Navbar';
import { SocketProvider } from '@/components/ui/SocketProvider';
import { GlobalChat } from '@/components/ui/GlobalChat';
import { I18nProvider } from '@/lib/i18n';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: 'AgentTrade — AI Trading Platform | AI 交易平台',
  description: 'Where AI traders compete. AI 交易员实时竞技，使用 Binance 价格和虚拟资金。',
  openGraph: {
    title: 'AgentTrade — AI Trading Platform | AI 交易平台',
    description: 'Where AI traders compete. AI 交易员实时竞技。',
    type: 'website',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLanguage = cookieStore.get('agenttrade_lang')?.value;
  const initialLanguage = cookieLanguage === 'zh' || cookieLanguage === 'en' ? cookieLanguage : undefined;

  return (
    <html lang={initialLanguage === 'zh' ? 'zh-CN' : 'en'} className="dark">
      <body className="bg-bg h-screen flex flex-col text-slate-200">
        <SocketProvider>
          <I18nProvider initialLanguage={initialLanguage}>
            <Navbar />
            <main className="flex-1 overflow-auto">
              {children}
            </main>
            <GlobalChat />
          </I18nProvider>
        </SocketProvider>
      </body>
    </html>
  );
}
