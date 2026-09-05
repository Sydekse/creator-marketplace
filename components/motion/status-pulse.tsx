'use client';

import { useReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Isolated breathing status mark. Infinite motion lives here so the parent
 * page never re-renders for it.
 */
export function StatusPulse({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <span
      className={cn('relative inline-flex size-1.5', className)}
      aria-hidden
    >
      {!reduceMotion ? (
        <span className="absolute inset-0 rounded-full bg-current opacity-40 motion-safe:animate-ping" />
      ) : null}
      <span className="relative size-1.5 rounded-full bg-current" />
    </span>
  );
}
