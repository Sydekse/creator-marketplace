import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Root not-found (KAN-81): every unmatched route and every `notFound()`
 * throw renders here instead of Next's default page — the admin deal
 * drill-down's 404 included.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh px-6 py-12 sm:px-10 sm:py-16">
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-5xl items-center">
        <div className="grid w-full gap-10 border-t border-neutral-200 pt-8 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)] md:gap-16">
          <div className="flex max-w-xl flex-col items-start gap-4">
            <p className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Route not found
            </p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-neutral-900 sm:text-5xl">
              This page is not here.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground">
              The link may be outdated, or the page may have moved.
            </p>
          </div>
          <div className="flex items-end justify-start md:justify-end">
            <div className="flex flex-wrap gap-2">
              <Link href="/" className={buttonVariants()}>
                Go home
              </Link>
              <Link
                href="/sign-in"
                className={buttonVariants({ variant: 'outline' })}
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
