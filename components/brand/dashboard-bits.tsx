'use client';

import { useEffect, useRef } from 'react';

/**
 * Time-of-day greeting. The server cannot know the visitor's clock, so it
 * renders the neutral fallback and the effect swaps in the local greeting
 * after mount — same words as the v4 mock, no hydration mismatch. The swap
 * writes to the DOM directly (like the count-up) so the effect synchronizes
 * an external system instead of re-rendering.
 */
export function Greeting() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = new Date().getHours();
    el.textContent =
      h < 5
        ? 'Working late'
        : h < 12
          ? 'Good morning'
          : h < 18
            ? 'Good afternoon'
            : 'Good evening';
  }, []);

  return <span ref={ref}>Welcome back</span>;
}

/**
 * The mock's count-up: eases to the real value in 900ms with cubic ease-out.
 * The server renders the final number (correct without JS and for crawlers);
 * the effect replays the count on mount unless the user prefers reduced
 * motion.
 */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      el.textContent = Math.round(
        value * (1 - Math.pow(1 - p, 3))
      ).toLocaleString('en-US');
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span ref={ref}>{value.toLocaleString('en-US')}</span>;
}
