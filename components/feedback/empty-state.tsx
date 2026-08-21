import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  align?: 'center' | 'start';
}

/**
 * The empty state (design doc §5.2 — editorial density): airy, serif title,
 * one-line description. Replaces content only where there genuinely is none.
 */
export function EmptyState({
  title,
  description,
  action,
  align = 'center',
}: EmptyStateProps) {
  const centered = align === 'center';

  return (
    <div
      className={`flex flex-col gap-3 py-20 ${
        centered ? 'items-center text-center' : 'items-start text-left'
      }`}
    >
      <h3 className="font-display text-xl font-medium text-foreground">
        {title}
      </h3>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
