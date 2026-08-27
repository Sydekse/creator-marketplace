'use client';

/**
 * Tiny living status on a legal document. Isolated so the pulse never
 * re-renders the page. CSS-only; gated by prefers-reduced-motion.
 */
export function InEffectMark() {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        <span className="absolute inset-0 rounded-full bg-brand motion-safe:animate-ping motion-safe:opacity-40" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-brand" />
      </span>
      In effect
    </span>
  );
}
