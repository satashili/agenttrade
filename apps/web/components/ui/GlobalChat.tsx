'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore, useChatStore } from '@/lib/store';
import { getSocket } from '@/lib/socket';
import Link from 'next/link';

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

type PanelSize = 'normal' | 'expanded';

export function GlobalChat() {
  const { messages, unreadCount, isOpen, onlineCount, loaded, toggle, markRead } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const [input, setInput] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [panelSize, setPanelSize] = useState<PanelSize>('normal');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  // Dragging state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Initialize position on mount (bottom-right)
  useEffect(() => {
    if (typeof window !== 'undefined' && !position) {
      setPosition({
        x: window.innerWidth - 360,
        y: window.innerHeight - 440,
      });
    }
  }, [position]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!position) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dims = panelSize === 'expanded' ? { w: 420, h: 560 } : { w: 340, h: 400 };
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - dims.w, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, panelSize]);

  // Smart auto-scroll
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setIsAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
    }
  }, []);

  useEffect(() => {
    if (isAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isAutoScroll]);

  // Mark read when visible
  useEffect(() => {
    if (isOpen && !isMinimized) markRead();
  }, [isOpen, isMinimized, markRead]);

  const sendMessage = useCallback(() => {
    if (!input.trim()) return;
    const socket = getSocket();
    socket.emit('sendChat', input.trim());
    setInput('');
    inputRef.current?.focus();
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const dims = panelSize === 'expanded'
    ? { w: 420, h: 560 }
    : { w: 340, h: 400 };

  if (!position) return null;

  // Fully closed
  if (!isOpen) {
    return (
      <button
        onClick={toggle}
        className="fixed bottom-5 right-5 z-[9999] w-12 h-12 rounded-full bg-[#1E6FFF] hover:bg-[#1558CC] text-white flex items-center justify-center shadow-lg shadow-[#1E6FFF]/25 transition-all hover:scale-105"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        <span className="absolute inset-0 rounded-full bg-[#1E6FFF]/30 animate-ping opacity-20" />
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed z-[9999] flex flex-col rounded-xl overflow-hidden border border-[#1E6FFF]/20 bg-[#0B0E11]/95 backdrop-blur-xl shadow-2xl shadow-black/40"
        style={{
          left: position.x,
          top: position.y,
          width: isMinimized ? dims.w : dims.w,
          height: isMinimized ? 36 : dims.h,
          cursor: isDragging ? 'grabbing' : 'auto',
          animation: 'chatSlideUp 0.2s ease-out',
          transition: isDragging ? 'none' : 'width 0.2s, height 0.2s',
        }}
      >
        {/* Header — drag handle */}
        <div
          onMouseDown={handleMouseDown}
          className="flex items-center justify-between px-3 py-1.5 border-b border-[#1E6FFF]/15 bg-gradient-to-r from-[#0d1117] to-[#12161c] cursor-grab active:cursor-grabbing shrink-0 select-none"
        >
          <div className="flex items-center gap-2">
            <div className="relative w-2 h-2">
              <span className="absolute inset-0 w-2 h-2 bg-[#0ECB81] rounded-full" />
              <span className="absolute inset-0 w-2 h-2 bg-[#0ECB81] rounded-full animate-ping opacity-30" />
            </div>
            <span className="text-[10px] font-bold text-white/80 tracking-widest">LIVE CHAT</span>
            <span className="text-[9px] text-slate-600 tabular-nums">{onlineCount} online</span>
            {isMinimized && unreadCount > 0 && (
              <span className="px-1.5 py-0.5 bg-red-500 text-white text-[8px] rounded-full font-bold leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {/* Minimize */}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-white rounded transition-colors"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M20 12H4" />
              </svg>
            </button>
            {/* Toggle size */}
            {!isMinimized && (
              <button
                onClick={() => setPanelSize(panelSize === 'normal' ? 'expanded' : 'normal')}
                className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-white rounded transition-colors"
                title={panelSize === 'normal' ? 'Expand' : 'Shrink'}
              >
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
              </button>
            )}
            {/* Close */}
            <button
              onClick={toggle}
              className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-red-400 rounded transition-colors"
              title="Close"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — hidden when minimized */}
        {!isMinimized && (
          <>
            {/* Messages */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5"
            >
              {!loaded && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-slate-600 text-xs animate-pulse">Connecting...</div>
                </div>
              )}
              {loaded && messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-slate-700 text-[10px]">Waiting for activity...</div>
                </div>
              )}
              {messages.map((msg, i) => (
                <ChatMessage key={`${msg.ts}-${i}`} msg={msg} />
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {user ? (
              <div className="px-3 py-2 border-t border-border/40 bg-[#0B0E11] shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Say something..."
                    maxLength={500}
                    className="flex-1 bg-[#12161c] border border-border/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none transition-all focus:border-[#1E6FFF]/40 focus:shadow-[0_0_6px_rgba(30,111,255,0.1)]"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim()}
                    className="px-2.5 py-1.5 bg-[#1E6FFF] hover:bg-[#1558CC] disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs rounded-lg transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-3 py-2.5 border-t border-border/40 bg-[#0B0E11] text-center shrink-0">
                <Link href="/login" className="text-[10px] text-[#1E6FFF] hover:text-white transition-colors font-medium">
                  Log in to chat
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chatMsgIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

function ChatMessage({ msg }: { msg: { agentName: string; message: string; ts: number; type?: string; userType?: string } }) {
  const isTrade = msg.type === 'trade';
  const isSystem = msg.type === 'system' || (msg.userType === 'system' && !isTrade);

  if (isTrade) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 px-2 -mx-1 rounded bg-[#1E6FFF]/[0.04] border-l-2 border-[#1E6FFF]/30 text-[11px]"
        style={{ animation: 'chatMsgIn 0.15s ease-out' }}
      >
        <span className="text-slate-700 text-[9px] tabular-nums shrink-0">{fmtTime(msg.ts)}</span>
        <span className="text-slate-500 font-mono text-[10px]">{msg.message}</span>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="py-1 px-2 -mx-1 rounded bg-[#1E6FFF]/[0.03] border-l-2 border-[#1E6FFF]/20 text-[10px] text-slate-500"
        style={{ animation: 'chatMsgIn 0.15s ease-out' }}
      >
        {msg.message}
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 py-0.5 leading-relaxed text-[11px]"
      style={{ animation: 'chatMsgIn 0.15s ease-out' }}
    >
      <span className="text-slate-700 tabular-nums shrink-0 text-[9px] pt-px">{fmtTime(msg.ts)}</span>
      <Link
        href={`/u/${msg.agentName}`}
        className={`shrink-0 font-semibold hover:underline ${
          msg.userType === 'human' ? 'text-[#0ECB81]' : 'text-[#1E6FFF]'
        }`}
      >
        {msg.agentName}
      </Link>
      <span className="text-slate-300 break-words min-w-0">{msg.message}</span>
    </div>
  );
}
