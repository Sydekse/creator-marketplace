import type { ReactNode } from 'react';
import Link from 'next/link';
import { Mark } from '@/components/brand/mark';
import { InEffectMark } from '@/components/legal/in-effect-mark';
import { LegalSections } from '@/components/legal/legal-sections';
import { MagneticLink } from '@/components/legal/magnetic-link';
import { Reveal } from '@/components/marketing/reveal';
import { cn, textLinkFeedback } from '@/lib/utils';

export interface LegalTocItem {
  id: string;
  n: string;
  title: string;
}

/**
 * Public legal document chrome.
 *
 * Skill (higher precedence): variance 8 split layout, motion 6 stagger +
 * magnetic CTA, density 4, phosphor-free here because the page is type-led.
 * design.md: serif display, one teal on labels, hairlines, 4px grid, whisper
 * easing, reduced-motion via Reveal/CSS, no card around a document.
 */
export function LegalPage({
  label,
  title,
  updated,
  sibling,
  toc,
  children,
}: {
  label: string;
  title: string;
  updated: string;
  sibling: { href: string; label: string };
  toc: readonly LegalTocItem[];
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-[100dvh] bg-neutral-50 text-neutral-900 antialiased">
      {/* Grain stays on a fixed, non-scrolling layer (skill §5). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.035]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #171717 0, #171717 1px, transparent 1px, transparent 3px), repeating-linear-gradient(90deg, #171717 0, #171717 1px, transparent 1px, transparent 3px)',
          backgroundSize: '3px 3px',
        }}
      />

      <nav
        aria-label="Primary"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3"
      >
        <div className="pointer-events-auto flex h-14 w-full max-w-6xl items-center justify-between rounded-full border border-neutral-800 bg-neutral-900/95 px-3 shadow-[0_12px_32px_rgba(23,23,23,0.18),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur">
          <Link
            href="/"
            aria-label="Creator Marketplace home"
            className="flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            <Mark tone="light" />
            <span className="text-[13px] font-semibold tracking-tight text-neutral-50">
              Creator Marketplace
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={sibling.href}
              className="hidden rounded-full px-3 py-2 text-[13px] text-neutral-400 transition-colors duration-300 ease-out hover:text-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 sm:block"
            >
              {sibling.label}
            </Link>
            <MagneticLink href="/sign-in">Sign in</MagneticLink>
          </div>
        </div>
      </nav>

      <main className="relative z-[2] px-6 pt-28 pb-24 sm:px-10 sm:pt-36 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="grid items-end gap-10 border-b border-neutral-200 pb-14 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)] lg:gap-24">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
                  {label}
                </p>
                <h1 className="mt-5 font-display text-4xl font-medium leading-none tracking-tighter text-neutral-900 md:text-6xl">
                  {title}
                </h1>
              </div>
              <div className="flex flex-col gap-4 lg:items-end lg:pb-1 lg:text-right">
                <InEffectMark />
                <p className="text-sm text-neutral-500">
                  Last updated {updated}
                </p>
                <Link
                  href={sibling.href}
                  className={cn('text-sm text-neutral-600', textLinkFeedback)}
                >
                  {sibling.label}
                </Link>
              </div>
            </div>
          </Reveal>

          <div className="mt-16 grid items-start gap-16 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.4fr)] lg:gap-24">
            <aside className="hidden lg:block">
              <nav
                aria-label="On this page"
                className="sticky top-24 flex flex-col gap-1"
              >
                {toc.map((item, index) => (
                  <Reveal key={item.id} delay={index * 60}>
                    <a
                      href={`#${item.id}`}
                      className="group grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline gap-3 rounded-[4px] py-2 text-sm text-neutral-500 transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.99]"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-neutral-400 group-hover:text-brand">
                        {item.n}
                      </span>
                      <span>{item.title}</span>
                    </a>
                  </Reveal>
                ))}
              </nav>
            </aside>

            <article
              className={cn(
                'max-w-[65ch]',
                '[&_section]:scroll-mt-28 [&_section]:border-t [&_section]:border-neutral-200 [&_section]:pt-10 [&_section]:pb-2',
                '[&_section:first-child]:border-t-0 [&_section:first-child]:pt-0',
                '[&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-[0.14em] [&_h2]:text-brand',
                '[&_p]:mt-4 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-neutral-600',
                '[&_ul]:mt-4 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-3',
                '[&_li]:relative [&_li]:pl-5 [&_li]:text-base [&_li]:leading-relaxed [&_li]:text-neutral-600',
                '[&_li]:before:absolute [&_li]:before:top-[0.7em] [&_li]:before:left-0 [&_li]:before:h-1 [&_li]:before:w-1 [&_li]:before:rounded-full [&_li]:before:bg-neutral-400'
              )}
            >
              <LegalSections>{children}</LegalSections>
            </article>
          </div>
        </div>
      </main>

      <footer className="relative z-[2] border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Mark tone="dark" />
            <span className="text-[13px] font-semibold tracking-tight">
              Creator Marketplace
            </span>
          </Link>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-neutral-600">
            <Link href="/terms" className={textLinkFeedback}>
              Terms of Service
            </Link>
            <Link href="/privacy" className={textLinkFeedback}>
              Privacy Policy
            </Link>
            <Link href="/" className={textLinkFeedback}>
              Home
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
