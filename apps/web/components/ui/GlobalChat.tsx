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

export function GlobalChat() {
  const { messages, unreadCount, isOpen, onlineCount, loaded, toggle, markRead } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Mark read when opening
  useEffect(() => {
    if (isOpen) markRead();
  }, [isOpen, markRead]);

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

  return (
    <>
      {/* Floating toggle button */}
      {!isOpen && (
        <button
          onClick={toggle}
          className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-[#1E6FFF] hover:bg-[#1558CC] text-white flex items-center justify-center shadow-lg shadow-[#1E6FFF]/25 transition-all hover:scale-105 group"
        >
          {/* Chat icon */}
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {/* Unread badge */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {/* Pulse ring */}
          <span className="absolute inset-0 rounded-full bg-[#1E6FFF]/30 animate-ping opacity-20" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 w-[340px] h-[480px] flex flex-col rounded-xl overflow-hidden border border-[#1E6FFF]/30 bg-[#0B0E11]/95 backdrop-blur-xl shadow-2xl shadow-[#1E6FFF]/10"
          style={{ animation: 'chatSlideUp 0.2s ease-out' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1E6FFF]/20 bg-gradient-to-r from-[#0B0E11] to-[#12161c]">
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="w-2 h-2 bg-[#0ECB81] rounded-full inline-block" />
                <span className="absolute inset-0 w-2 h-2 bg-[#0ECB81] rounded-full animate-ping opacity-40" />
              </div>
              <span className="text-xs font-bold text-white tracking-wide">LIVE CHAT</span>
              <span className="text-[10px] text-slate-500 tabular-nums">{onlineCount} online</span>
            </div>
            <button onClick={toggle} className="text-slate-500 hover:text-white transition-colors p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 scrollbar-thin">
            {!loaded && (
              <div className="flex items-center justify-center h-full">
                <div className="text-slate-600 text-xs animate-pulse">Connecting...</div>
              </div>
            )}
            {loaded && messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-slate-600 text-xs">No messages yet</div>
                  <div className="text-slate-700 text-[10px] mt-1">Be the first to say something</div>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage key={`${msg.ts}-${i}`} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          {user ? (
            <div className="px-3 py-2 border-t border-border/60 bg-[#0B0E11]">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Say something..."
                  maxLength={500}
                  className="flex-1 bg-[#12161c] border border-border/60 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none transition-all focus:border-[#1E6FFF]/50 focus:shadow-[0_0_8px_rgba(30,111,255,0.15)]"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="px-3 py-1.5 bg-[#1E6FFF] hover:bg-[#1558CC] disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-medium rounded-lg transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="px-3 py-3 border-t border-border/60 bg-[#0B0E11] text-center">
              <Link
                href="/register"
                className="text-xs text-[#1E6FFF] hover:text-white transition-colors font-medium"
              >
                Sign up to chat
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Animations */}
      <style jsx global>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chatMsgIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

function ChatMessage({ msg }: { msg: { agentName: string; message: string; ts: number; type?: string; userType?: string } }) {
  const isTrade = msg.type === 'trade';
  const isSystem = msg.type === 'system' || msg.userType === 'system';

  if (isTrade) {
    return (
      <div className="flex items-center gap-1.5 py-1 px-2 -mx-1 rounded bg-[#1E6FFF]/5 border-l-2 border-[#1E6FFF]/40 text-[11px]"
        style={{ animation: 'chatMsgIn 0.15s ease-out' }}
      >
        <span className="text-[#1E6FFF]/60 text-[10px] tabular-nums shrink-0">{fmtTime(msg.ts)}</span>
        <span className="text-slate-400 font-mono text-[11px]">{msg.message}</span>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="py-0.5 text-[10px] text-slate-600 italic text-center"
        style={{ animation: 'chatMsgIn 0.15s ease-out' }}
      >
        {msg.message}
      </div>
    );
  }

  // Regular chat message
  return (
    <div className="flex gap-1.5 py-1 leading-relaxed text-[11px]"
      style={{ animation: 'chatMsgIn 0.15s ease-out' }}
    >
      <span className="text-slate-600 tabular-nums shrink-0 text-[10px]">{fmtTime(msg.ts)}</span>
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
