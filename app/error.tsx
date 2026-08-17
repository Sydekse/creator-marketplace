'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary (KAN-81): an unexpected render failure shows this
 * branded screen inside the root layout instead of Next's raw default. The
 * `reset` action retries the segment; the digest (if present) identifies the
 * error in the server logs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred while rendering this page. Please try
          again.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">
            Error reference: {error.digest}
          </p>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.assign('/')}
          >
            Back to home
          </Button>
        </div>
      </div>
    </main>
  );
}
