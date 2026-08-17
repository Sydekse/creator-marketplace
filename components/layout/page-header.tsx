import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The page opener (design doc §10.5). Every app page opens with the same
 * rhythm: an uppercase teal label, the serif page title, a one-line
 * description, and a hairline. Editorial at the top, working below it.
 */
export function PageHeader({
  label,
  title,
  description,
  action,
  hairline = true,
  className,
}: {
  label?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  hairline?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {label ? (
        <p className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
          {label}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="page-title">{title}</h1>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {description ? (
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {hairline ? (
        <div className="mt-1 border-b border-neutral-200" aria-hidden="true" />
      ) : null}
    </header>
  );
}
