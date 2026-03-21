'use client';
import { useCallback, useEffect, useRef } from 'react';

interface Props {
  onResize: (delta: number) => void;
  direction?: 'vertical' | 'horizontal';
}

export function ResizeHandle({ onResize, direction = 'vertical' }: Props) {
  const dragging = useRef(false);
  const lastPos = useRef(0);
  const isHorizontal = direction === 'horizontal';

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastPos.current = isHorizontal ? e.clientY : e.clientX;
    document.body.style.cursor = isHorizontal ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, [isHorizontal]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const pos = isHorizontal ? e.clientY : e.clientX;
      const delta = pos - lastPos.current;
      lastPos.current = pos;
      onResize(delta);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onResize, isHorizontal]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={
        isHorizontal
          ? "h-1 shrink-0 cursor-row-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
          : "w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
      }
    />
  );
}
