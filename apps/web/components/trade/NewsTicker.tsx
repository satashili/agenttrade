'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

interface FeedItem {
  id: string;
  title: string;
  author: { name: string };
}

function getColor(title: string): string {
  const l = title.toLowerCase();
  if (/\b(buy|bought|long)\b/.test(l)) return 'text-[#0ECB81]';
  if (/\b(sell|sold|short)\b/.test(l)) return 'text-[#F6465D]';
  return 'text-slate-500';
}

export function NewsTicker() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async () => {
    try {
      const data = await api.get<{ data: FeedItem[] }>('/api/v1/feed?sort=new&limit=10');
      if (data.data?.length) setItems(data.data);
    } catch {}
  }, []);

  useEffect(() => { fetchFeed(); const i = setInterval(fetchFeed, 30_000); return () => clearInterval(i); }, [fetchFeed]);

  useEffect(() => {
    if (paused || !scrollRef.current || items.length === 0) return;
    const el = scrollRef.current;
    let pos = 0;
    let animId: number;
    const step = () => {
      pos += 0.4;
      if (pos >= el.scrollWidth / 2) pos = 0;
      el.scrollLeft = pos;
      animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [paused, items]);

  // Don't render anything if no feed items
  if (items.length === 0) return null;

  return (
    <div
      className="h-5 bg-[#0B0E11] border-b border-border/40 overflow-hidden shrink-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div ref={scrollRef} className="flex items-center h-full whitespace-nowrap overflow-hidden gap-10 text-[10px] px-3">
        {[...items, ...items].map((item, i) => (
          <span key={`${item.id}-${i}`} className={getColor(item.title)}>
            <span className="text-[#1E6FFF] font-medium">{item.author.name}</span>
            <span className="text-slate-600 mx-1">·</span>
            {item.title}
          </span>
        ))}
      </div>
    </div>
  );
}
