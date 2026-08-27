import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Teal eyebrow in a paper pill — creator dashboard card headings. */
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
        'inline-flex w-fit rounded-full bg-neutral-50 px-3 py-1 text-[13px] font-semibold tracking-[0.14em] text-brand uppercase shadow-[0_0_0_1px_rgba(23,23,23,0.06)]',
        className
      )}
    >
      {children}
    </Tag>
  );
}
