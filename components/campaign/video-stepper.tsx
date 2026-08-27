'use client';

import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * Compact video-count stepper. Phosphor carets, same control on the creator
 * shortlist and the discover bulk bar.
 */
export function VideoStepper({
  value,
  onChange,
  name,
  id,
  size = 'md',
}: {
  value: number;
  onChange: (next: number) => void;
  name?: string;
  id?: string;
  size?: 'sm' | 'md';
}) {
  const compact = size === 'sm';

  function clamp(next: number) {
    if (!Number.isInteger(next) || next < 1) return 1;
    if (next > 100) return 100;
    return next;
  }

  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800',
        compact ? 'h-9 rounded-lg' : 'h-11'
      )}
    >
      <button
        type="button"
        aria-label="Fewer videos"
        disabled={value <= 1}
        onClick={() => onChange(clamp(value - 1))}
        className={cn(
          'grid place-items-center text-neutral-300 transition-colors duration-150 hover:bg-neutral-700 hover:text-neutral-50 active:scale-[0.98] disabled:opacity-40',
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
          '[appearance:textfield] border-x border-neutral-700 bg-transparent text-center font-medium text-neutral-50 tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          compact ? 'w-10 text-sm' : 'w-12 text-sm'
        )}
      />
      <button
        type="button"
        aria-label="More videos"
        disabled={value >= 100}
        onClick={() => onChange(clamp(value + 1))}
        className={cn(
          'grid place-items-center text-neutral-300 transition-colors duration-150 hover:bg-neutral-700 hover:text-neutral-50 active:scale-[0.98] disabled:opacity-40',
          compact ? 'w-8' : 'w-10'
        )}
      >
        <CaretUp size={compact ? 12 : 14} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
