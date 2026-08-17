import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Root not-found (KAN-81): every unmatched route and every `notFound()`
 * throw renders here instead of Next's default page — the admin deal
 * drill-down's 404 included.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-4xl font-bold tracking-tight">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/" className={buttonVariants()}>
            Back to home
          </Link>
          <Link
            href="/sign-in"
            className={buttonVariants({ variant: 'outline' })}
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
