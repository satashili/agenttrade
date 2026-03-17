'use client';
import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useMarketStore, useChatStore } from '@/lib/store';
import { api } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { setPrices, addTradeActivity } = useMarketStore();
  const { addMessage, setMessages, setOnlineCount, setLoaded, loaded } = useChatStore();

  // Load chat history once
  useEffect(() => {
    if (loaded) return;
    api.get<{ data: any[] }>('/api/v1/chat/history?limit=50')
      .then(res => {
        setMessages(res.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loaded, setMessages, setLoaded]);

  useEffect(() => {
    const socket = getSocket();

    socket.on('prices', (prices) => {
      setPrices(prices as any);
    });

    socket.on('tradeActivity', (activity) => {
      addTradeActivity(activity);
    });

    socket.on('chatMessage', (msg: any) => {
      addMessage(msg);
    });

    socket.on('onlineCount', (count: any) => {
      setOnlineCount(count);
    });

    return () => {
      socket.off('prices');
      socket.off('tradeActivity');
      socket.off('chatMessage');
      socket.off('onlineCount');
    };
  }, [setPrices, addTradeActivity, addMessage, setOnlineCount]);

  return <>{children}</>;
}
