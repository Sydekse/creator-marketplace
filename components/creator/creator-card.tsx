import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { NICHE_LABELS } from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import type { DiscoveryCreator } from '@/lib/creators/discovery';
import { tiktokProfileUrl } from '@/lib/creators/handle';
import {
  VIEW_ON_TIKTOK_LABEL,
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { formatEtb } from '@/lib/money';

/**
 * One creator in the discovery results (KAN-29, US-004, AC-012).
 *
 * Replaces a row that showed a handle, a niche and a price. AC-012 names four
 * facts a brand needs in order to shortlist without opening every profile, and
 * two of them — the follower count and the engagement rate — were being fetched
 * and then not rendered. So this is a rendering change: `readDiscovery` already
 * returns everything below.
 *
 * The price is read straight off `creator.pricePerVideo`, which comes from the
 * joined `pricing_tier` row. AC-012's "never a stale or independently computed
 * price" is therefore structural rather than careful — there is no arithmetic on
 * this path to get wrong, and `formatEtb` is the only thing between the column
 * and the screen (invariant 4).
 *
 * No contact details appear here, and none could: `DiscoveryCreator` selects
 * none and the query joins no account table, so NFR-010 holds at the query
 * rather than by this component's restraint.
 *
 * A Server Component. `components/ui/card.tsx` is plain `<div>`s with no
 * `'use client'`, and both of the card's interactions are links rather than
 * `onClick`s — so they middle-click, open in a new tab, and cost no client
 * bundle. KAN-200 added the second one (out to TikTok) and that is why the card
 * link stretches instead of wrapping: two anchors cannot nest.
 */

function Fact({
  label,
  value,
  note,
  mono = true,
}: {
  label: string;
  value: string;
  note?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>
        {value}
        {note ? (
          <span className="ml-1.5 font-sans text-xs text-muted-foreground">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

export function CreatorCard({ creator }: { creator: DiscoveryCreator }) {
  const profileUrl = tiktokProfileUrl(creator.tiktokHandle);

  return (
    // `h-full` so cards in a row match height when one handle wraps. `relative`
    // is what makes the stretched link below work, and `focus-within` moves the
    // ring onto the card now that the link no longer wraps it.
    <Card className="relative h-full transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-foreground/25">
      {/* The whole-card hit target. It covers the card instead of wrapping it
          because an `<a>` inside an `<a>` is invalid HTML — the browser closes
          the outer one early and the TikTok link ends up outside the card
          (KAN-200). Empty, so it needs an `aria-label`: the handle is the only
          name a screen reader could announce it by. */}
      <Link
        href={`/discover/${creator.id}`}
        aria-label={creator.tiktokHandle}
        className="absolute inset-0 rounded-xl"
      />
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <InitialsAvatar name={creator.tiktokHandle} />
            <span>{creator.tiktokHandle}</span>
          </div>
          {/* The tier name is context for the price beside it, not a fact a
              brand filters on, so it reads as a label rather than a figure. */}
          <span className="text-xs font-normal tracking-wide text-muted-foreground uppercase">
            {creator.tierName}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Two columns at phone widths and four from `sm:` up (NFR-007). No
            fixed widths anywhere, so nothing here can scroll sideways at
            375px — the facts reflow instead. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Fact
            label="Niche"
            value={NICHE_LABELS[creator.niche as Niche] ?? creator.niche}
            mono={false}
          />
          {/* Absent is not zero. Both of these come from
              `lib/creators/profile-facts.ts`, which is also what the creator's
              own dashboard renders them through, so a blank optional field
              cannot read as a claim on one screen and a gap on the other. */}
          <Fact
            label="Followers"
            value={formatFollowerCount(creator.followerCount)}
          />
          <Fact
            label="Engagement"
            value={formatEngagementRate(creator.engagementRate)}
          />
          <Fact
            label="Price"
            value={formatEtb(creator.pricePerVideo)}
            note="per video"
          />
        </dl>

        {/* `relative z-10` lifts this above the stretched link, which otherwise
            covers it. `noopener noreferrer` because the tab we open must not get
            a handle on ours, and `nofollow` because we are not vouching for a
            profile nobody has checked yet. */}
        {profileUrl && (
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="relative z-10 self-start text-xs font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            {VIEW_ON_TIKTOK_LABEL} ↗
          </a>
        )}
      </CardContent>
    </Card>
  );
}
