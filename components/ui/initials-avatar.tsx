import { cn } from '@/lib/utils';

/**
 * A 2-letter initial avatar using the Bungee display font.
 *
 * Derives initials from the user's name:
 *   - 2+ words → first letter of part[0] + first letter of part[1]  ("Naod Sima" → "NS")
 *   - 1 word   → first two letters                                   ("Naod" → "NA")
 *
 * Always uppercase. No client JS — pure string rendering.
 */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

const SIZE_CLASSES = {
  sm: 'size-6 text-[10px]',
  default: 'size-8 text-xs',
  lg: 'size-12 text-base',
} as const;

export function InitialsAvatar({
  name,
  size = 'default',
  className,
}: {
  name: string;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        'bg-white border border-neutral-200',
        'shadow-[0_4px_12px_rgba(23,23,23,0.02)]',
        'font-[family-name:var(--font-bungee)] font-normal uppercase',
        'text-neutral-900 select-none',
        SIZE_CLASSES[size],
        className
      )}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  );
}
