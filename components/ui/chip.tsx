import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The one status chip (design doc §10.3). Tones map to the status vocabulary
 * — teal/success = good, amber = waiting, red = bad, gray = neutral, dark =
 * ink-on-light, line = hairline. The accent (teal) is for good states only;
 * it never doubles as a neutral.
 */
const chipTones = {
  teal: 'bg-brand-tint text-brand-ink',
  success: 'bg-status-verified text-status-verified-foreground',
  amber: 'bg-status-pending text-status-pending-foreground',
  red: 'bg-destructive/10 text-destructive',
  gray: 'bg-neutral-100 text-neutral-600',
  dark: 'bg-neutral-900 text-neutral-50',
  line: 'border border-neutral-200 text-neutral-600',
} as const;

export type ChipTone = keyof typeof chipTones;

export function Chip({
  tone = 'gray',
  size = 'sm',
  className,
  children,
}: {
  tone?: ChipTone;
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full font-medium',
        size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs',
        chipTones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
