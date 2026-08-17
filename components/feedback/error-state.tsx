'use client';

import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/**
 * The in-page error state. Same editorial rhythm as the empty state; the
 * retry button is the shared pill button, so it carries the system's
 * focus ring and micro-interactions for free.
 */
export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h3 className="font-display text-xl font-medium text-destructive">
        {title}
      </h3>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}
