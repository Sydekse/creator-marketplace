import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Teal eyebrow in a paper pill — section labels everywhere (app + public). */
export function SectionLabel({
  children,
  as: Tag = 'h2',
  className,
}: {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'p';
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        'inline-flex w-fit rounded-full bg-neutral-50 px-3 py-1 text-[13px] font-semibold tracking-[0.14em] text-brand-ink uppercase shadow-[0_0_0_1px_color-mix(in_oklch,var(--brand)_28%,transparent)]',
        className
      )}
    >
      {children}
    </Tag>
  );
}
