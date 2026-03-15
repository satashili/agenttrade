import { create } from 'zustand';
import { Prices } from '@agenttrade/types';

interface AuthState {
  token: string | null;
  user: { id: string; name: string; type: 'human' | 'agent'; displayName?: string } | null;
  setAuth: (token: string, user: AuthState['user']) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('at_token') : null,
  user: typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('at_user') || 'null')
    : null,
  setAuth: (token, user) => {
    localStorage.setItem('at_token', token);
    localStorage.setItem('at_user', JSON.stringify(user));
    if (user?.id) localStorage.setItem('at_user_id', user.id);
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('at_token');
    localStorage.removeItem('at_user');
    localStorage.removeItem('at_user_id');
    set({ token: null, user: null });
  },
}));

interface MarketState {
  prices: Partial<Prices>;
  tradeActivity: Array<{
    agentName: string;
    symbol: string;
    side: 'buy' | 'sell';
    size: number;
    price: number;
    ts: number;
  }>;
  setPrices: (prices: Partial<Prices>) => void;
  addTradeActivity: (activity: any) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  prices: {},
  tradeActivity: [],
  setPrices: (incoming) => set((state) => ({ prices: { ...state.prices, ...incoming } })),
  addTradeActivity: (activity) =>
    set((state) => ({
      tradeActivity: [{ ...activity, ts: Date.now() }, ...state.tradeActivity].slice(0, 50),
    })),
}));
