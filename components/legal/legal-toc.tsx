'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Reveal } from '@/components/marketing/reveal';
import { cn } from '@/lib/utils';
import type { LegalTocItem } from './legal-page';

/**
 * "On this page" navigation for legal documents, in two placements:
 *
 * - `LegalToc` — the desktop sticky sidebar (grid column included).
 * - `LegalTocMobile` — a `<details>` disclosure above the article, so the
 *   section map is not simply missing on small screens.
 *
 * Both share the scrollspy: an IntersectionObserver over the section ids
 * marks the link for the section currently in the reading band.
 */
function useScrollSpy(toc: readonly LegalTocItem[]) {
  const [active, setActive] = useState(toc[0]?.id);

  useEffect(() => {
    const sections = toc
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // Reading band: a section counts while it crosses the upper-middle of
      // the viewport, so the highlight moves before the heading hits the top.
      { rootMargin: '-30% 0px -60% 0px' }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [toc]);

  return active;
}

function TocLink({
  item,
  active,
}: {
  item: LegalTocItem;
  active: boolean;
}) {
  return (
    <a
      href={`#${item.id}`}
      aria-current={active ? 'location' : undefined}
      className={cn(
        'group grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline gap-3 rounded-[4px] py-2 text-sm transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.99]',
        active ? 'text-neutral-900' : 'text-neutral-600'
      )}
    >
      <span
        className={cn(
          'font-mono text-[11px] tabular-nums transition-colors duration-300 ease-out group-hover:text-brand-ink',
          active ? 'text-brand-ink' : 'text-neutral-600'
        )}
      >
        {item.n}
      </span>
      <span>{item.title}</span>
    </a>
  );
}

export function LegalToc({ toc }: { toc: readonly LegalTocItem[] }) {
  const active = useScrollSpy(toc);
  return (
    <aside className="hidden lg:block">
      <nav
        aria-label="On this page"
        className="sticky top-24 flex flex-col gap-1"
      >
        {toc.map((item, index) => (
          <Reveal key={item.id} delay={index * 60}>
            <TocLink item={item} active={active === item.id} />
          </Reveal>
        ))}
      </nav>
    </aside>
  );
}

export function LegalTocMobile({ toc }: { toc: readonly LegalTocItem[] }) {
  const active = useScrollSpy(toc);
  return (
    <details className="faq-item group mb-10 rounded-xl border border-neutral-200 px-4 py-3 lg:hidden">
      <summary className="flex list-none cursor-pointer items-center justify-between gap-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
        On this page
        <ChevronDown
          className="h-4 w-4 shrink-0 text-neutral-600 transition-transform duration-300 ease-out group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <nav aria-label="On this page" className="faq-answer mt-2 flex flex-col">
        {toc.map((item) => (
          <TocLink key={item.id} item={item} active={active === item.id} />
        ))}
      </nav>
    </details>
  );
}
