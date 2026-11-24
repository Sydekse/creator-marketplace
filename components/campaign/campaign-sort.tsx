'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef } from 'react';
import { NavActivePill } from '@/components/nav/nav-active-pill';
import { CAMPAIGN_SORTS, isCampaignSortKey } from '@/lib/campaigns/sort';

/**
 * The campaign list's sort control — the top bar's exact selector grammar:
 * a clipped dark track, `NavActivePill` sliding between options (never
 * escaping the container, reduced-motion aware), light pill on the active
 * entry. Links carry the sort in the URL, so the order is shareable and the
 * server does the sorting.
 */
export function CampaignSort() {
  const searchParams = useSearchParams();
  const param = searchParams.get('sort');
  const sort = isCampaignSortKey(param) ? param : 'newest';
  const trackRef = useRef<HTMLDivElement>(null);

  return (
    <nav
      aria-label="Sort campaigns"
      className="rounded-full border border-neutral-200 bg-neutral-50 p-1"
    >
      {/* The measured track is padding- and border-free, so the sliding pill
          aligns exactly with the links and never touches the outer border. */}
      <div
        ref={trackRef}
        className="relative flex items-center gap-0.5 overflow-hidden rounded-full"
      >
        <NavActivePill
          containerRef={trackRef}
          activeKey={sort}
          className="bg-neutral-900"
        />
        {CAMPAIGN_SORTS.map((s) => (
          <Link
            key={s.key}
            href={
              s.key === 'newest' ? '/campaigns' : `/campaigns?sort=${s.key}`
            }
            scroll={false}
            data-active={sort === s.key || undefined}
            aria-current={sort === s.key ? 'true' : undefined}
            className="relative z-[1] flex h-8 items-center rounded-full px-4 text-[12.5px] font-medium text-neutral-500 transition-colors duration-200 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 active:scale-[0.98] data-[active]:bg-neutral-900 data-[active]:text-neutral-50 data-[active]:hover:text-neutral-50"
          >
            {s.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
