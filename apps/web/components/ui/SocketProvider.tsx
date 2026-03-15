'use client';
import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useMarketStore } from '@/lib/store';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { setPrices, addTradeActivity } = useMarketStore();

  useEffect(() => {
    const socket = getSocket();

    socket.on('prices', (prices) => {
      setPrices(prices as any);
    });

    socket.on('tradeActivity', (activity) => {
      addTradeActivity(activity);
    });

    return () => {
      socket.off('prices');
      socket.off('tradeActivity');
    };
  }, [setPrices, addTradeActivity]);

  return <>{children}</>;
}
