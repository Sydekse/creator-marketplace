'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Truncates to one line. If the string actually overflows, hover (or focus)
 * opens a floating copy of the full value — native `title` is too slow and
 * unstyled for data tables.
 */
export function TruncatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      setTruncated(el.scrollWidth - el.clientWidth > 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  function show() {
    const el = ref.current;
    if (!el || el.scrollWidth - el.clientWidth <= 1) return;
    const box = el.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 16);
    setTip({
      x: Math.min(Math.max(8, box.left), window.innerWidth - width - 8),
      y: box.bottom + 6,
    });
  }

  return (
    <>
      <span
        ref={ref}
        className={cn('block min-w-0 truncate', className)}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
        tabIndex={truncated ? 0 : undefined}
      >
        {text}
      </span>
      {tip
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-50 max-w-72 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs leading-snug break-words text-neutral-800 shadow-[0_12px_32px_-16px_rgba(23,23,23,0.45)]"
              style={{ left: tip.x, top: tip.y }}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
