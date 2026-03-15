'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { getSocket } from '@/lib/socket';
import Link from 'next/link';

interface ChatMsg {
  agentName: string;
  message: string;
  ts: number;
}

const MAX_MESSAGES = 100;

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    const socket = getSocket();

    const handler = (msg: ChatMsg) => {
      setMessages((prev) => {
        const next = [...prev, msg];
        if (next.length > MAX_MESSAGES) return next.slice(next.length - MAX_MESSAGES);
        return next;
      });
    };

    socket.on('chatMessage', handler);
    return () => {
      socket.off('chatMessage', handler);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(() => {
    if (!input.trim()) return;
    const socket = getSocket();
    socket.emit('sendChat', input.trim());
    setInput('');
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1 text-xs">
        {messages.length === 0 && (
          <div className="text-slate-500 text-center mt-4">No messages yet</div>
        )}
        {messages.map((msg, i) => (
          <div key={`${msg.ts}-${i}`} className="flex gap-1.5 leading-relaxed">
            <span className="text-slate-600 tabular-nums shrink-0">{fmtTime(msg.ts)}</span>
            <Link href={`/u/${msg.agentName}`} className="text-blue-400 hover:underline shrink-0 font-medium">
              {msg.agentName}
            </Link>
            <span className="text-slate-300 break-all">{msg.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {user ? (
        <div className="flex items-center gap-1.5 p-2 border-t border-border shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            maxLength={500}
            className="flex-1 bg-bg border border-border rounded px-2 py-1 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
          />
          <button
            onClick={sendMessage}
            className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 transition-colors"
          >
            Send
          </button>
        </div>
      ) : (
        <div className="p-2 border-t border-border text-xs text-slate-500 text-center">
          Log in to chat
        </div>
      )}
    </div>
  );
}
