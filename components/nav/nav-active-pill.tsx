'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * One selector that slides inside a clipped nav track. layoutId was flying the
 * pill out of the bar for a frame (same bug as the sign-up role notch).
 */
export function NavActivePill({
  containerRef,
  activeKey,
  orientation = 'horizontal',
  className,
}: {
  containerRef: RefObject<HTMLElement | null>;
  activeKey: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const seen = useRef(false);
  const [box, setBox] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    show: false,
    snap: true,
  });

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const measure = () => {
      const active = root.querySelector('[data-active]') as HTMLElement | null;
      if (!active) {
        setBox((prev) => ({ ...prev, show: false }));
        return;
      }
      const snap = !seen.current;
      seen.current = true;
      setBox({
        x: active.offsetLeft,
        y: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
        show: true,
        snap,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [activeKey, containerRef]);

  const duration = reduceMotion || box.snap ? 0 : 0.28;

  if (!box.show) return null;

  const animate =
    orientation === 'horizontal'
      ? { x: box.x, width: box.width, height: box.height, y: 0 }
      : { y: box.y, height: box.height, width: box.width, x: 0 };

  return (
    <motion.span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-0 left-0 rounded-full',
        className
      )}
      initial={false}
      animate={animate}
      transition={{ duration, ease: EASE }}
    />
  );
}
