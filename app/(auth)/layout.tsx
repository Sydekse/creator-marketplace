import Link from 'next/link';
import { AuthPanel } from './auth-panel';
import { Mark } from '@/components/brand/mark';
import { Toaster } from '@/components/ui/sonner';

/**
 * The auth shell. At `lg` the page splits asymmetrically: the form column on
 * the left keeps the landing's paper and ledger grid, while the right half is
 * the teal image panel carrying one escrow claim. Below `lg` the panel steps aside and the
 * form column stands alone.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-neutral-50 text-neutral-900 antialiased lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,44%)]">
      {/* Form column */}
      <div className="relative flex min-h-screen flex-col overflow-hidden">
        {/* The landing's ledger grid, faded before it can compete with the card. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'linear-gradient(to right, oklch(0.88 0 0 / 0.3) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.88 0 0 / 0.3) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
            maskImage:
              'radial-gradient(ellipse at center, black, transparent 85%)',
          }}
        />
        <header className="relative flex justify-center px-4 pt-4 sm:px-8 sm:pt-6">
          <Link
            href="/"
            className="auth-reveal-mark flex items-center gap-3 rounded-full transition-transform duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Mark tone="dark" />
            <span className="text-[13px] font-semibold tracking-tight text-neutral-900">
              Creator Marketplace
            </span>
          </Link>
        </header>

        <main className="auth-reveal-card relative flex min-h-0 flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-10 lg:py-6">
          {children}
        </main>
      </div>

      <AuthPanel />

      <Toaster />
    </div>
  );
}
