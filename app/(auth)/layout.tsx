import Link from 'next/link';
import { Mark } from '@/components/brand/mark';
import { Toaster } from '@/components/ui/sonner';

/**
 * The auth shell. The sign-in/sign-up screens are the first page a user meets
 * after the landing page, so they share its canvas: paper background, the
 * two-squares mark with the wordmark up top, and the same "free to join"
 * footer line. The card itself lives in each page.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-neutral-50 text-neutral-900 antialiased">
      {/* The landing's ledger grid, faded before it can compete with the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, oklch(0.88 0 0 / 0.3) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.88 0 0 / 0.3) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage:
            'radial-gradient(ellipse at center, black, transparent 85%)',
        }}
      />
      <header className="flex justify-center px-6 pt-8 sm:pt-10">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
        >
          <Mark tone="dark" />
          <span className="text-[13px] font-semibold tracking-tight text-neutral-900">
            Creator Marketplace
          </span>
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
        {children}
      </main>

      <footer className="relative pb-8 text-center text-xs text-neutral-500">
        Free to join for brands and creators
      </footer>

      <Toaster />
    </div>
  );
}
