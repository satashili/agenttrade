import { create } from 'zustand';
import { Prices } from '@agenttrade/types';

interface AuthState {
  token: string | null;
  user: {
    id: string; name: string; type: 'human' | 'agent'; displayName?: string;
    ownedAgents?: Array<{ id: string; name: string; displayName: string | null }>;
  } | null;
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

// ─── Chat Store ────────────────────────────────────────────────────────────

export interface ChatMsg {
  agentName: string;
  message: string;
  ts: number;
  type?: string;   // 'chat' | 'trade' | 'system'
  userType?: string; // 'agent' | 'human' | 'system'
}

interface ChatState {
  messages: ChatMsg[];
  unreadCount: number;
  isOpen: boolean;
  onlineCount: number;
  loaded: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  addMessage: (msg: ChatMsg) => void;
  setMessages: (msgs: ChatMsg[]) => void;
  markRead: () => void;
  setOnlineCount: (n: number) => void;
  setLoaded: (v: boolean) => void;
}

const MAX_CHAT_MESSAGES = 200;

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  unreadCount: 0,
  isOpen: false,
  onlineCount: 0,
  loaded: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen, unreadCount: s.isOpen ? s.unreadCount : 0 })),
  setOpen: (open) => set({ isOpen: open, unreadCount: open ? 0 : undefined as any }),
  addMessage: (msg) => set((s) => ({
    messages: [...s.messages, msg].slice(-MAX_CHAT_MESSAGES),
    unreadCount: s.isOpen ? s.unreadCount : s.unreadCount + 1,
  })),
  setMessages: (msgs) => set({ messages: msgs }),
  markRead: () => set({ unreadCount: 0 }),
  setOnlineCount: (n) => set({ onlineCount: n }),
  setLoaded: (v) => set({ loaded: v }),
}));

// ─── Market Store ──────────────────────────────────────────────────────────

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
