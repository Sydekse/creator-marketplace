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
        <main className="min-h-dvh px-6 py-12 sm:px-10 sm:py-16">
          <div className="mx-auto flex min-h-[70dvh] w-full max-w-5xl items-center">
            <div className="grid w-full gap-10 border-t border-neutral-200 pt-8 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)] md:gap-16">
              <div className="flex max-w-xl flex-col items-start gap-4">
                <p className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
                  System error
                </p>
                <h1 className="font-display text-4xl font-medium tracking-tight text-neutral-900 sm:text-5xl">
                  We could not open the workspace.
                </h1>
                <p className="max-w-md text-base leading-relaxed text-muted-foreground">
                  Try again, or return home while we recover the page.
                </p>
                {error.digest && (
                  <p className="font-mono text-xs text-muted-foreground">
                    Error reference: {error.digest}
                  </p>
                )}
              </div>
              <div className="flex items-end justify-start md:justify-end">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="btn-shine inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98]"
                  >
                    Try again
                  </button>
                  <Link
                    href="/"
                    className="inline-flex h-9 items-center justify-center rounded-full border border-neutral-300 bg-background px-4 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:bg-neutral-200"
                  >
                    Back to home
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
