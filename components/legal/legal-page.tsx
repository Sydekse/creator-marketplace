import type { ReactNode } from 'react';
import Link from 'next/link';
import { Mark } from '@/components/brand/mark';
import { cn, textLinkFeedback } from '@/lib/utils';

/**
 * Shared chrome for the public legal pages TikTok (and any other reviewer)
 * has to crawl without an account. Editorial header, working body, hairline
 * sections — same tokens as the landing page, denser because this is a
 * document, not a pitch.
 */
export function LegalPage({
  label,
  title,
  updated,
  children,
}: {
  label: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link
            href="/"
            aria-label="Creator Marketplace home"
            className="flex items-center gap-3 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Mark tone="dark" />
            <span className="text-[13px] font-semibold tracking-tight">
              Creator Marketplace
            </span>
          </Link>
          <Link
            href="/"
            className={cn('text-[13px] text-neutral-600', textLinkFeedback)}
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
          {label}
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-neutral-900 sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-neutral-500">Last updated {updated}</p>
        <div className="mt-12 flex flex-col gap-10 border-t border-neutral-200 pt-10 text-sm leading-relaxed text-neutral-600 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 [&_li]:mt-2 [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
    </div>
  );
}
