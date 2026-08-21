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
    <main className="min-h-dvh px-6 py-12 sm:px-10 sm:py-16">
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-5xl items-center">
        <div className="grid w-full gap-10 border-t border-neutral-200 pt-8 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)] md:gap-16">
          <div className="flex max-w-xl flex-col items-start gap-4">
            <p className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Something went wrong
            </p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-neutral-900 sm:text-5xl">
              We could not load this page.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground">
              Try again, or return to the workspace and continue from there.
            </p>
            {error.digest && (
              <p className="font-mono text-xs text-muted-foreground">
                Error reference: {error.digest}
              </p>
            )}
          </div>
          <div className="flex items-end justify-start md:justify-end">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={reset}>
                Try again
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.assign('/')}
              >
                Go home
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
