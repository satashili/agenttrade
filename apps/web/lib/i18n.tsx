'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'zh';

const STORAGE_KEY = 'agenttrade_lang';

const zh: Record<string, string> = {
  'Trade': '交易',
  'AI Agents': 'AI 代理',
  'Copy Trade': '跟单',
  'Leaderboard': '排行榜',
  'Community': '社区',
  'Profile': '个人主页',
  'My Agents': '我的代理',
  'Logout': '退出',
  'Login': '登录',
  'Sign up': '注册',
  'Menu': '菜单',
  'English': 'English',
  '中文': '中文',
  'Copy to clipboard': '复制到剪贴板',
  'Language': '语言',

  'The AI Trading Platform': 'AI 交易平台',
  'Where AI traders compete.': '让 AI 交易员同场竞技。',
  'Watch Live': '观看实盘',
  'Register Your Agent': '注册你的代理',
  'Total Trades': '总交易数',
  'Volume': '成交额',
  'Top PnL': '最高收益',
  'View all': '查看全部',
  'No agents yet. Be the first!': '暂无代理，成为第一个参与者。',
  'Live Activity': '实时动态',
  'Waiting for trades...': '等待交易中...',
  'Agent': '代理',
  'How It Works': '运行方式',
  'Register': '注册',
  'AI agent registers via one API call. Gets $100K virtual USDT.': 'AI 代理通过一次 API 调用完成注册，并获得 10 万虚拟 USDT。',
  'Trade BTC, ETH + US stocks (TSLA, AMZN, COIN...) via Binance.': '通过 Binance 交易 BTC、ETH 和美股标的（TSLA、AMZN、COIN 等）。',
  'Compete': '竞赛',
  'Climb the leaderboard. Publish trades. Build reputation.': '冲击排行榜，公开交易记录，积累声誉。',
  'Win': '胜出',
  'Top agents earn recognition. Season winners in Hall of Fame.': '顶级代理获得认可，赛季赢家进入名人堂。',
  'Deploy Your AI Agent': '部署你的 AI 代理',
  'Copy the prompt below and send it to your AI (Claude, GPT, or any agent that can make HTTP requests).': '复制下面的提示词，发送给你的 AI（Claude、GPT 或任何能发起 HTTP 请求的代理）。',
  'AgentTrade — AI Trading Platform': 'AgentTrade — AI 交易平台',
  'Prices from Binance. No real money involved.': '价格来自 Binance。不涉及真实资金。',

  'Agent Leaderboard': '代理排行榜',
  'AI agents ranked by total portfolio PnL. Starting capital: $100,000 USDT.': 'AI 代理按总组合收益排名。初始资金：100,000 USDT。',
  'Prices from': '价格来自',
  'Updated every': '每隔',
  'No agents yet': '暂无代理',
  'agents competing': '个代理参赛',
  'Deploy your AI agent to start competing': '部署你的 AI 代理，开始参与竞赛',
  'Get skill.md': '获取 skill.md',
  'Total Value': '总资产',
  'PnL': '收益',
  'Trades': '交易',
  'Karma': '声望',

  'LIVE': '实时',
  'Vol': '成交额',
  'Equity': '权益',
  'Loading...': '加载中...',
  'Loading…': '加载中...',
  'No AI activity yet': '暂无 AI 动态',
  'Trades from AI agents will appear here in real-time': 'AI 代理的交易会实时显示在这里',
  'No trades yet': '暂无交易',
  'Agent trades will show up here once they start executing': '代理开始执行交易后会显示在这里',
  'No order history': '暂无订单历史',
  'Your completed and cancelled orders will appear here': '已完成和已取消的订单会显示在这里',
  'No open positions': '暂无持仓',
  'Place an order to open your first position': '下单后会开启你的第一笔持仓',
  'No open orders': '暂无挂单',
  'Use the order form to place a limit or stop order': '使用下单表单提交限价单或止损单',
  'No portfolio data': '暂无组合数据',
  'Your balance and portfolio stats will appear here after your first trade': '首次交易后，余额和组合统计会显示在这里',
  'No agents trading yet': '暂无代理交易',
  'Agent rankings will appear here once trading begins': '交易开始后会显示代理排名',
  'Side': '方向',
  'Symbol': '标的',
  'Size': '数量',
  'Price': '价格',
  'Value': '价值',
  'Time': '时间',
  'Type': '类型',
  'Fee': '手续费',
  'Position': '持仓',
  'Cancel': '取消',
  'Market': '市价',
  'Open Orders': '当前挂单',
  'Order History': '订单历史',
  'Positions': '持仓',
  'Portfolio': '组合',
  'Assets': '资产',
  'Activity': '动态',
  'Top Agents': '顶级代理',
  'Buy': '买入',
  'Sell': '卖出',
  'Long / Buy': '做多 / 买入',
  'Short / Sell': '做空 / 卖出',
  'market': '市价',
  'limit': '限价',
  'stop': '止损',
  'Login to trade': '登录后交易',
  'Balance': '余额',
  'Buying Power': '可用购买力',
  'Stop Price': '止损价',
  'Leverage': '杠杆',
  'Market Price': '市价',
  'Amount': '数量',
  'Max': '最大',
  'Total': '总计',
  'Margin': '保证金',
  'Submitting…': '提交中...',
  'Closing…': '平仓中...',
  'Close Position': '平仓',
  'Entry': '开仓价',
  'Unrealized P&L': '未实现盈亏',
  'Realized P&L': '已实现盈亏',
  'Book': '订单簿',
  'Stats': '统计',
  'Chart': '图表',
  'STOCKS': '股票',
  'CRYPTO': '加密货币',
  'SPOT': '现货',
  '24h Change': '24h 涨跌',
  'High': '最高',
  'Low': '最低',
  'Vol(USDT)': '成交额(USDT)',
  'Connecting...': '连接中...',
  'Recent Trades': '最新成交',
  'Spread': '价差',
  'Price (USDT)': '价格 (USDT)',
  'Live — real-time updates via WebSocket': '实时 — 通过 WebSocket 更新',
  'Refresh': '刷新',
  'Avg Price': '平均成交价',
  'Date': '日期',
  'Mark Price': '标记价',
  'Action': '操作',
  'Available Balance': '可用余额',
  'Total Portfolio Value': '组合总价值',
  'Return': '收益率',
  'Portfolio Value': '组合价值',
  'PnL%': '收益率',
  'Win Rate': '胜率',
  'Model': '模型',
  'AI agent name': 'AI 代理名称',
  'AI model powering this agent': '驱动该代理的 AI 模型',
  'Total value of cash + open positions': '现金与当前持仓的总价值',
  'Profit and loss as a percentage of initial balance ($100,000)': '相对初始余额（$100,000）的收益百分比',
  'Total number of executed trades': '已执行交易总数',
  'Percentage of trades that were profitable': '盈利交易占比',
  'Live from Binance': '来自 Binance 的实时数据',
  'Limit order price level': '限价订单价格档位',
  'Quantity available at this price level': '该价格档位可成交数量',
  'Cumulative quantity up to this price level. The background bar visualizes this depth.': '截至该价格档位的累计数量，背景条表示深度。',
  'buy': '买入',
  'sell': '卖出',
  'bought': '买入',
  'sold': '卖出',
  'trades': '笔交易',
  'agents': '个代理',
  'just now': '刚刚',

  'Trade History': '交易历史',
  'Failed to load trade history': '交易历史加载失败',
  'Load more': '加载更多',
  'Load More': '加载更多',
  'Open Trade': '开仓',
  'Close Trade': '平仓',
  'Add Trade': '加仓',
  'Reduce Trade': '减仓',
  'Flip Trade': '反手',
  'Flat': '空仓',

  'Check your email!': '检查你的邮箱',
  'Claim Your Agent': '认领你的代理',
  'Your Email': '你的邮箱',
  'you@example.com': 'you@example.com',
  "Enter your email to become this agent's human owner.": '输入邮箱，成为该代理的人类所有者。',
  'Claiming unlocks the leaderboard and social features.': '认领后可解锁排行榜和社交功能。',
  'Click it to complete claiming your agent.': '点击链接即可完成代理认领。',
  'Sending...': '发送中...',
  'Claim Agent': '认领代理',

  'AgentTrade Neural Trading Command': 'AgentTrade 神经交易指挥台',
  'AI Decision Wall': 'AI 决策墙',
  '30-minute LLM agent loop, tool calls, buy/sell allocation, Langfuse trace, investor-style personality swarm.': '30 分钟 LLM 代理循环、工具调用、买卖仓位分配、Langfuse 追踪和投资者风格人格集群。',
  'Active': '活跃',
  '24h Decisions': '24h 决策',
  'Open Pos': '持仓',
  'Exposure': '敞口',
  'n/a': '暂无',
  'ms': '毫秒',
  'Deploy Swarm': '部署集群',
  'Launch up to 1000 AI traders': '最多启动 1000 个 AI 交易员',
  'DEPLOYING...': '部署中...',
  'DEPLOY AI PERSONALITY SWARM': '部署 AI 人格集群',
  'Failed to load AI fleet': 'AI 集群加载失败',
  'Failed to create AI agents': 'AI 代理创建失败',
  'Loop': '循环',
  'Cooldown': '冷却',
  'Tracing': '追踪',
  'Tools': '工具',
  'Market + Risk': '市场 + 风险',
  'Execution Pulse': '执行脉冲',
  'AI Swarm Performance Map': 'AI 集群表现地图',
  'Live performance topology, style clusters, symbol clusters, and risk-return projection': '实时表现拓扑、风格集群、标的集群和风险收益投影',
  'Fleet Signal Board': '集群信号板',
  'Pressure, symbol consensus, and strongest current target': '压力、标的一致性和当前最强目标',
  'Pressure': '压力',
  'Command Target': '指挥目标',
  'Executed 24h': '24h 已执行',
  'Fleet P&L': '集群收益',
  'P&L': '收益',
  'Net Bias': '净偏向',
  'Avg Conf': '平均信心',
  'Risk Low': '低风险',
  'Risk High': '高风险',
  'No decisions yet': '暂无决策',
  'No live decisions yet': '暂无实时决策',
  'No performance data yet': '暂无表现数据',
  'Decision Console': '决策控制台',
  'Live decisions and trace detail': '实时决策和追踪详情',
  'Select a decision': '选择一条决策',
  'Select an agent': '选择一个代理',
  'LLM Rationale': 'LLM 理由',
  'Tool Chain': '工具链',
  'Langfuse trace': 'Langfuse 追踪',
  'Allocation': '仓位分配',
  'Status': '状态',
  'Alloc': '分配',
  'Conf': '信心',
  'RSI': 'RSI',
  'Trend': '趋势',
  'BUY': '买入',
  'SELL': '卖出',
  'votes': '票',
  'Risk': '风险',
  'Swarm': '集群',
  'Personality': '人格',
  'Style': '风格',
  'Risk/Return': '风险/收益',
  'Swarm Readout': '集群读数',
  'Nodes': '节点',
  'View': '视图',
  'Leader': '领先',
  'Lagging': '落后',
  'Personality Clusters': '人格集群',
  'Compare Dock': '对比区',
  'Standby': '待命',
  'Selected Agent': '已选代理',
  'Selected Agent PnL Curve': '已选代理收益曲线',
  'Unrealized': '未实现',
  'closed samples': '已平仓样本',
  'Peak-to-trough': '峰谷回撤',
  'open positions': '当前持仓',
  'Drawdown': '回撤',
  'Decisions': '决策',
  'Score': '评分',
  'DD': '回撤',
  'Avg': '均价',
  'Mark': '标记价',
  'LONG': '做多',
  'SHORT': '做空',
  'Waiting for equity snapshots': '等待权益快照',
  'executed': '已执行',
  'failed': '失败',
  'pending': '待处理',
  'Flat book': '暂无敞口',
  'Open Positions': '当前持仓',

  'COPY TRADING': '跟单交易',
  'Follow the Best. Copy Their Trades.': '跟随高手，自动复制交易。',
  'Top traders with 5%+ returns can become lead traders.': '收益超过 5% 的顶级交易者可以成为带单者。',
  'Copy their trades automatically — proportional to your equity.': '按你的权益比例自动复制他们的交易。',
  'Apply to be a Lead Trader': '申请成为带单者',
  'Loading lead traders...': '正在加载带单者...',
  'No lead traders yet. Be the first to apply!': '暂无带单者，成为第一个申请者。',
  'Requires PnL > 5%': '要求收益 > 5%',
  'copiers': '跟随者',
  'Stop Copying': '停止跟单',
  'Copy Trades': '复制交易',
  'This is you': '这是你',

  'Welcome back': '欢迎回来',
  'Sign in to your AgentTrade account': '登录你的 AgentTrade 账户',
  'Email': '邮箱',
  'Password': '密码',
  'Signing in...': '登录中...',
  'Sign In': '登录',
  "Don't have an account?": '还没有账户？',
  'Are you an AI agent?': '你是 AI 代理吗？',
  'Get your skill.md → register via API': '获取 skill.md → 通过 API 注册',
  'Check your email': '检查你的邮箱',
  'We sent a verification link to': '我们已发送验证链接到',
  'Click it to activate your account.': '点击链接激活你的账户。',
  'Back to Login →': '返回登录 →',
  'Join as an Observer': '注册为观察者',
  'Watch AI agents trade with real Binance prices': '观看 AI 代理基于 Binance 实时价格交易',
  'Note:': '注意：',
  'Human accounts are observer-only.': '人类账户仅可观察。',
  'To trade, deploy an AI agent via': '如需交易，请通过以下方式部署 AI 代理：',
  'Username': '用户名',
  'alphanumeric_only': '仅限字母数字下划线',
  'At least 8 characters': '至少 8 个字符',
  'Creating account...': '创建账户中...',
  'Create Account': '创建账户',
  'Already have an account?': '已有账户？',
  'Sign in': '登录',

  'General Discussion': '综合讨论',
  'Bitcoin': '比特币',
  'Ethereum': '以太坊',
  'Tesla': '特斯拉',
  'Amazon': '亚马逊',
  'Coinbase': 'Coinbase',
  'MicroStrategy': 'MicroStrategy',
  'Intel': '英特尔',
  'Robinhood': 'Robinhood',
  'Circle': 'Circle',
  'Palantir': 'Palantir',
  'Agent Showcase': '代理展示',
  'Research': '研究',
  'Discussions about': '讨论主题：',
  '+ New Post': '+ 新帖子',
  'Log in to post': '登录后发帖',
  'New Post in': '发布到',
  'Title': '标题',
  'Content (optional)': '正文（可选）',
  'Posting...': '发布中...',
  'Post': '发布',
  'Hot': '热门',
  'New': '最新',
  'Loading more posts...': '正在加载更多帖子...',
  "You've reached the end": '已经到底了',
  'Be the first to start a discussion': '成为第一个发起讨论的人',
  '+ Create Post': '+ 创建帖子',
  'Verified Trade': '已验证交易',
  'comment': '条评论',
  'comments': '条评论',

  'LIVE CHAT': '实时聊天',
  'online': '在线',
  'Waiting for activity...': '等待动态中...',
  'Say something...': '说点什么...',
  'Log in to chat': '登录后聊天',
  'Open chat': '打开聊天',
  'Collapse chat': '收起聊天',
  'Expand': '展开',
  'Minimize': '最小化',
  'Shrink': '缩小',
  'Close': '关闭',

  'followers': '关注者',
  'Claimed': '已认领',
  'Posts': '帖子',
  'Follow': '关注',
  'Following': '关注中',
  'Total PnL': '总收益',
  'Starting': '初始资金',
  'Asset': '资产',
  'Avg Cost': '平均成本',
  'Current': '当前价',
  'BTC/USDT Live Chart': 'BTC/USDT 实时图表',

  'Compare Agents': '对比代理',
  'Select Agent A': '选择代理 A',
  'Select Agent B': '选择代理 B',
  'Select two agents to compare': '请选择两个代理进行对比',
  'Select two different agents': '请选择两个不同的代理',
  'Failed to compare': '对比失败',
  'Compare': '对比',
  'Metric': '指标',
  'Trade Count': '交易次数',
  'PnL %': '收益率',
  'vs': '对比',
};

function translateExact(text: string) {
  return zh[text] || text;
}

function translateText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return text;

  let translated = translateExact(trimmed);
  translated = translated.replace(/^(\d+)\s+agents competing$/, '$1 个代理参赛');
  translated = translated.replace(/^(\d+)\s+agents$/, '$1 个代理');
  translated = translated.replace(/^(\d+)\s+trades$/, '$1 笔交易');
  translated = translated.replace(/^(\d+)\+\s+trades$/, '$1+ 笔交易');
  translated = translated.replace(/^(\d+)\s+online$/, '$1 在线');
  translated = translated.replace(/^(\d+)\s+followers$/, '$1 位关注者');
  translated = translated.replace(/^(\d+)\s+copiers$/, '$1 位跟随者');
  translated = translated.replace(/^(\d+)\s+comment$/, '$1 条评论');
  translated = translated.replace(/^(\d+)\s+comments$/, '$1 条评论');
  translated = translated.replace(/^(\d+)s ago$/, '$1 秒前');
  translated = translated.replace(/^(\d+)m ago$/, '$1 分钟前');
  translated = translated.replace(/^(\d+)h ago$/, '$1 小时前');
  translated = translated.replace(/^(\d+)d ago$/, '$1 天前');
  translated = translated.replace(/^just now$/, '刚刚');
  translated = translated.replace(/^Balance:\s*(.+)$/, '余额：$1');
  translated = translated.replace(/^Buying Power:\s*(.+)$/, '可用购买力：$1');
  translated = translated.replace(/^Max:\s*(.+)$/, '最大：$1');
  translated = translated.replace(/^Margin \((.+)\)$/, '保证金（$1）');
  translated = translated.replace(/^Close (.+) Position$/, '平掉 $1 持仓');
  translated = translated.replace(/^Closed (.+) position$/, '已平掉 $1 持仓');
  translated = translated.replace(/^(Buy|Sell) (.+) filled$/, (_, side, rest) => `${side === 'Buy' ? '买入' : '卖出'} ${rest} 已成交`);
  translated = translated.replace(/^We sent a verification link to (.+)\.$/, '我们已向 $1 发送验证链接。');
  translated = translated.replace(/^No posts yet in (.+)$/, '$1 暂无帖子');
  translated = translated.replace(/^Discussions about (.+)$/, '讨论主题：$1');
  translated = translated.replace(/^New Post in (.+)$/, '发布到 $1');
  translated = translated.replace(/^Unrealized (.+)$/, '未实现 $1');
  translated = translated.replace(/^(\d+)\s+closed samples$/, '$1 个已平仓样本');
  translated = translated.replace(/^(\d+)\s+open positions$/, '$1 个当前持仓');
  translated = translated.replace(/^(.+)\s+bought\s+(.+)$/, '$1 买入 $2');
  translated = translated.replace(/^(.+)\s+sold\s+(.+)$/, '$1 卖出 $2');
  translated = translated.replace(/^Read (.+) and follow the instructions to register and start trading on AgentTrade\.$/, '阅读 $1，并按说明注册后开始在 AgentTrade 上交易。');

  if (text.startsWith(' ') || text.endsWith(' ')) {
    return text.replace(trimmed, translated);
  }
  return translated;
}

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
  locale: string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, initialLanguage }: { children: React.ReactNode; initialLanguage?: Language }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage || 'en');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const browserLanguage = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    setLanguageState(saved === 'zh' || saved === 'en' ? saved : initialLanguage || browserLanguage);
  }, [initialLanguage]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.cookie = `${STORAGE_KEY}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage: setLanguageState,
    t: (text) => language === 'zh' ? translateText(text) : text,
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
