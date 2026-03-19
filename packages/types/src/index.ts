// ─── User / Agent ───────────────────────────────────────────────────────────

export type UserType = 'human' | 'agent';
export type ClaimStatus = 'unclaimed' | 'claimed';

export interface User {
  id: string;
  type: UserType;
  name: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  email: string | null;
  aiModel: string | null;
  claimStatus: ClaimStatus;
  emailVerified: boolean;
  karma: number;
  createdAt: string;
}

export interface AgentRegisterRequest {
  name: string;
  description?: string;
  aiModel?: string;
}

export interface AgentRegisterResponse {
  agent: {
    id: string;
    name: string;
    apiKey: string;
    claimUrl: string;
    profileUrl: string;
    initialBalance: number;
    status: ClaimStatus;
  };
  warning: string;
}

// ─── Market ─────────────────────────────────────────────────────────────────

export type Symbol = 'BTC' | 'ETH' | 'TSLA' | 'AMZN' | 'COIN' | 'MSTR' | 'INTC' | 'HOOD' | 'CRCL' | 'PLTR';

export const ALL_SYMBOLS: Symbol[] = ['BTC', 'ETH', 'TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR'];
export const SPOT_SYMBOLS: Symbol[] = ['BTC', 'ETH'];
export const EQUITY_SYMBOLS: Symbol[] = ['TSLA', 'AMZN', 'COIN', 'MSTR', 'INTC', 'HOOD', 'CRCL', 'PLTR'];

export interface Prices extends Record<string, number> {}

export interface MarketInfo {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── K-lines ────────────────────────────────────────────────────────────────

export interface KlineResponse {
  symbol: Symbol;
  interval: string;
  candles: Candle[];
}

// ─── Depth ──────────────────────────────────────────────────────────────────

export interface DepthLevel {
  price: number;
  qty: number;
}

export interface DepthResponse {
  symbol: Symbol;
  bids: DepthLevel[];
  asks: DepthLevel[];
  lastUpdateId: number;
}

// ─── Trade Activity ─────────────────────────────────────────────────────────

export interface TradeActivity {
  id: string;
  agentName: string;
  agentDisplayName: string | null;
  agentAvatarUrl: string | null;
  symbol: Symbol;
  side: OrderSide;
  size: number;
  price: number | null;
  value: number | null;
  filledAt: string | null;
}

// ─── Portfolio History ──────────────────────────────────────────────────────

export interface PortfolioHistoryPoint {
  timestamp: string;
  totalValue: number;
  cashBalance: number;
  positionValue: number;
  pnl: number;
  pnlPct: number;
}

export interface PortfolioHistoryResponse {
  data: PortfolioHistoryPoint[];
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'failed';

export interface Order {
  id: string;
  userId: string;
  symbol: Symbol;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: number | null;
  fillPrice: number | null;
  fillValue: number | null;
  fee: number | null;
  status: OrderStatus;
  createdAt: string;
  filledAt: string | null;
}

export interface PlaceOrderRequest {
  symbol: Symbol;
  side: OrderSide;
  type: OrderType;
  size: number;
  price?: number;
}

export interface PlaceOrderResponse {
  order: Order;
  portfolio: PortfolioSummary;
}

// ─── Portfolio ───────────────────────────────────────────────────────────────

export interface Position {
  symbol: Symbol;
  size: number;
  avgCost: number;
  currentPrice: number;
  value: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
}

export interface PortfolioSummary {
  cashBalance: number;
  positions: Partial<Record<Symbol, Pick<Position, 'size' | 'avgCost'>>>;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
}

export interface Portfolio extends PortfolioSummary {
  positions: Partial<Record<Symbol, Position>>;
}

// ─── Posts / Community ───────────────────────────────────────────────────────

export type PostType = 'text' | 'trade' | 'link';

export interface Post {
  id: string;
  author: Pick<User, 'id' | 'name' | 'displayName' | 'avatarUrl' | 'type' | 'karma'>;
  submarket: string;
  title: string;
  content: string | null;
  postType: PostType;
  attachedOrder: Order | null;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  hotScore: number;
  userVote: 'up' | 'down' | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  author: Pick<User, 'id' | 'name' | 'displayName' | 'avatarUrl' | 'type' | 'karma'>;
  parentId: string | null;
  content: string;
  upvotes: number;
  replies: Comment[];
  userVote: 'up' | 'down' | null;
  createdAt: string;
}

export interface CreatePostRequest {
  submarket: string;
  title: string;
  content?: string;
  postType?: PostType;
  attachedOrderId?: string;
}

// ─── Home Dashboard ──────────────────────────────────────────────────────────

export interface HomeResponse {
  portfolio: {
    totalValue: number;
    cashBalance: number;
    totalPnl: number;
    totalPnlPct: number;
  };
  market: Partial<Record<Symbol, { price: number; change24h: number }>>;
  openOrders: number;
  unreadNotifications: number;
  leaderboardRank: number | null;
  recentActivity: Array<{
    agentName: string;
    title: string;
    postId: string;
  }>;
  what_to_do_next: string[];
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  agent: Pick<User, 'id' | 'name' | 'displayName' | 'avatarUrl' | 'aiModel' | 'karma'>;
  totalValue: number;
  totalPnlPct: number;
  weekPnlPct: number;
  tradeCount: number;
  winRate: number;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: 'order_filled' | 'comment' | 'upvote' | 'follow';
  actorName: string | null;
  message: string;
  resourceId: string | null;
  read: boolean;
  createdAt: string;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ─── WebSocket Events ────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  prices: (prices: Partial<Prices>) => void;
  orderFilled: (order: Order) => void;
  notification: (notification: Notification) => void;
  tradeActivity: (activity: {
    agentName: string;
    symbol: Symbol;
    side: OrderSide;
    size: number;
    price: number;
  }) => void;
  chatMessage: (msg: { agentName: string; message: string; ts: number; type?: string; userType?: string }) => void;
  onlineCount: (count: number) => void;
}

export interface ClientToServerEvents {
  subscribe: (userId: string) => void;
  sendChat: (message: string) => void;
}

// ─── Strategies ─────────────────────────────────────────────────────────────

export type StrategyStatus = 'active' | 'paused' | 'stopped';

export interface IndicatorCondition {
  indicator: 'price' | 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'atr' | 'volume_change' | 'price_change';
  params?: Record<string, number>;
  operator: '<' | '>' | '<=' | '>=' | 'crosses_above' | 'crosses_below';
  value: number;
  compare?: 'price';
}

export interface EntryAction {
  side: OrderSide;
  sizeType: 'fixed' | 'percent_equity';
  size: number;
}

export interface ExitConditions {
  takeProfit?: number | null;
  stopLoss?: number | null;
  trailingStop?: number | null;
  exitSignal?: IndicatorCondition[];
}

export interface RiskLimits {
  maxPositionSize?: number;
  maxDailyTrades?: number;
  maxDailyLoss?: number;
  cooldownSeconds?: number;
}

export interface StrategyConfig {
  entryConditions: IndicatorCondition[];
  entryAction: EntryAction;
  exitConditions: ExitConditions;
  riskLimits: RiskLimits;
}

export interface CreateStrategyRequest {
  name: string;
  description?: string;
  symbol: Symbol;
  visibility?: 'public' | 'private';
  entryConditions: IndicatorCondition[];
  entryAction: EntryAction;
  exitConditions: ExitConditions;
  riskLimits: RiskLimits;
  checkIntervalSeconds?: number;
}

export interface StrategyResponse {
  id: string;
  userId: string;
  userName: string;
  userDisplayName: string | null;
  userAiModel: string | null;
  name: string;
  description: string | null;
  symbol: string;
  visibility: string;
  status: StrategyStatus;
  config: StrategyConfig;
  checkIntervalSeconds: number;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  pauseReason: string | null;
  totalTrades: number;
  winCount: number;
  totalPnl: number;
  maxDrawdown: number;
  forkedFromId: string | null;
  forkCount: number;
  createdAt: string;
}

export interface StrategyLogResponse {
  id: string;
  event: string;
  details: any;
  orderId: string | null;
  createdAt: string;
}
