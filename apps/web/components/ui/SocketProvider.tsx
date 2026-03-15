'use client';
import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useMarketStore } from '@/lib/store';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { setPrices, setOrderBook, addTradeActivity } = useMarketStore();

  useEffect(() => {
    const socket = getSocket();

    socket.on('prices', (prices) => {
      setPrices(prices as any);
    });

    socket.on('orderBook', (book) => {
      setOrderBook(book as any);
    });

    socket.on('tradeActivity', (activity) => {
      addTradeActivity(activity);
    });

    return () => {
      socket.off('prices');
      socket.off('orderBook');
      socket.off('tradeActivity');
    };
  }, [setPrices, setOrderBook, addTradeActivity]);

  return <>{children}</>;
}
