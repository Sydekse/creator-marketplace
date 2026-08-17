'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import './globals.css';

/**
 * Global error boundary (KAN-81): rendered in place of the root layout when
 * the layout itself fails, so it must define its own `<html>`/`<body>` and
 * import the styles the layout would have. Plain `<a>`/`<button>` because the
 * router context is not guaranteed here.
 */
export default function GlobalError({
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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background font-sans text-foreground">
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. Please try again.
            </p>
            {error.digest && (
              <p className="font-mono text-xs text-muted-foreground">
                Error reference: {error.digest}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="h-8 gap-1.5 rounded-[calc(var(--radius-md,0.5rem)-2px)] bg-primary px-2.5 text-sm text-primary-foreground"
              >
                Try again
              </button>
              <Link
                href="/"
                className="h-8 gap-1.5 rounded-[calc(var(--radius-md,0.5rem)-2px)] border border-border bg-background px-2.5 text-sm"
              >
                Back to home
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
