'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

interface FeedItem {
  id: string;
  title: string;
  author: { name: string };
}

function getColor(title: string): string {
  const lower = title.toLowerCase();
  if (/\b(buy|bought|long)\b/.test(lower)) return 'text-green-trade';
  if (/\b(sell|sold|short)\b/.test(lower)) return 'text-red-trade';
  return 'text-slate-400';
}

export function NewsTicker() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async () => {
    try {
      const data = await api.get<{ data: FeedItem[] }>('/api/v1/feed?sort=new&limit=10');
      setItems(data.data || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 30000);
    return () => clearInterval(interval);
  }, [fetchFeed]);

  useEffect(() => {
    if (paused || !scrollRef.current) return;
    const el = scrollRef.current;
    let animId: number;
    let pos = 0;

    const step = () => {
      pos += 0.5;
      if (pos >= el.scrollWidth / 2) pos = 0;
      el.scrollLeft = pos;
      animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [paused, items]);

  if (items.length === 0) return null;

  return (
    <div
      className="h-6 bg-bg-card border-b border-border overflow-hidden shrink-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        ref={scrollRef}
        className="flex items-center h-full whitespace-nowrap overflow-hidden gap-8 text-xs"
      >
        {/* Duplicate items for seamless loop */}
        {[...items, ...items].map((item, i) => (
          <span key={`${item.id}-${i}`} className={getColor(item.title)}>
            <span className="text-blue-400">{item.author.name}</span>: {item.title}
          </span>
        ))}
      </div>
    </div>
  );
}
