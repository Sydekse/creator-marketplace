'use client';

import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * Compact video-count stepper. Phosphor carets, same control on the creator
 * shortlist and the discover bulk bar. `tone` matches the surface it sits
 * on: `dark` for the neutral-900 batch bar, `light` for v4 paper cards.
 */
export function VideoStepper({
  value,
  onChange,
  name,
  id,
  size = 'md',
  tone = 'dark',
}: {
  value: number;
  onChange: (next: number) => void;
  name?: string;
  id?: string;
  size?: 'sm' | 'md';
  tone?: 'dark' | 'light';
}) {
  const compact = size === 'sm';
  const light = tone === 'light';

  function clamp(next: number) {
    if (!Number.isInteger(next) || next < 1) return 1;
    if (next > 100) return 100;
    return next;
  }

  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden rounded-xl border',
        light
          ? 'border-neutral-200 bg-white'
          : 'border-neutral-700 bg-neutral-800',
        compact ? 'h-9 rounded-lg' : 'h-11'
      )}
    >
      <button
        type="button"
        aria-label="Fewer videos"
        disabled={value <= 1}
        onClick={() => onChange(clamp(value - 1))}
        className={cn(
          'grid place-items-center transition-colors duration-150 active:scale-[0.98] disabled:opacity-40',
          light
            ? 'text-neutral-600 hover:bg-brand-tint hover:text-brand-ink'
            : 'text-neutral-300 hover:bg-neutral-700 hover:text-neutral-50',
          compact ? 'w-8' : 'w-10'
        )}
      >
        <CaretDown size={compact ? 12 : 14} weight="bold" aria-hidden />
      </button>
      <input
        id={id}
        name={name}
        type="number"
        min={1}
        max={100}
        value={value}
        aria-label="Videos"
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        className={cn(
          '[appearance:textfield] border-x bg-transparent text-center font-medium tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          light
            ? 'border-neutral-200 text-neutral-900'
            : 'border-neutral-700 text-neutral-50',
          compact ? 'w-10 text-sm' : 'w-12 text-sm'
        )}
      />
      <button
        type="button"
        aria-label="More videos"
        disabled={value >= 100}
        onClick={() => onChange(clamp(value + 1))}
        className={cn(
          'grid place-items-center transition-colors duration-150 active:scale-[0.98] disabled:opacity-40',
          light
            ? 'text-neutral-600 hover:bg-brand-tint hover:text-brand-ink'
            : 'text-neutral-300 hover:bg-neutral-700 hover:text-neutral-50',
          compact ? 'w-8' : 'w-10'
        )}
      >
        <CaretUp size={compact ? 12 : 14} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
