import { cn } from '@/lib/utils';

/**
 * The two-squares brand mark. One component, two tones — `light` for dark
 * surfaces (the landing nav pill), `dark` for light surfaces (the app header,
 * footer). Extracted from the landing page so the app header shares the mark
 * instead of shipping its own logo (design doc §10.1).
 */
export function Mark({
  tone = 'light',
  className,
}: {
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-lg',
        tone === 'light' ? 'bg-neutral-50' : 'bg-neutral-900',
        className
      )}
    >
      <span className="relative block h-3 w-3">
        <span
          className={cn(
            'absolute left-0 top-0 h-2 w-2 rounded-[4px]',
            tone === 'light' ? 'bg-neutral-900' : 'bg-neutral-50'
          )}
        />
        <span
          className={cn(
            'absolute bottom-0 right-0 h-2 w-2 rounded-[4px]',
            tone === 'light' ? 'bg-neutral-300' : 'bg-neutral-500'
          )}
        />
      </span>
    </span>
  );
}
