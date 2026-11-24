import Link from 'next/link';
import { ArrowSquareOut, TiktokLogo } from '@phosphor-icons/react/dist/ssr';
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
import { TruncatedText } from '@/components/ui/truncated-text';
import { cn, textLinkFeedback } from '@/lib/utils';

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
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bd-discfact">
      <dt className="bd-discfactlab">{label}</dt>
      <dd className="bd-discfactval bd-mono">
        <TruncatedText text={value} />
        {note ? (
          <TruncatedText text={note} className="bd-discfactnote" />
        ) : null}
      </dd>
    </div>
  );
}

export function CreatorCard({
  creator,
  detailsHref,
}: {
  creator: DiscoveryCreator;
  /**
   * Where the whole-card hit target goes. Defaults to the detail view. Pass
   * `null` when a wrapping component owns the card's click — the discover
   * grid's mark-and-add selection does, and a stretched link under it would
   * navigate on the click that was meant to mark the tile.
   */
  detailsHref?: string | null;
}) {
  const profileUrl = tiktokProfileUrl(creator.tiktokHandle);
  const href =
    detailsHref === undefined ? `/discover/${creator.id}` : detailsHref;

  return (
    // An `<article>` in the v4 card grammar rather than the shadcn Card —
    // `relative` is what makes the stretched link below work, and
    // `focus-within` moves the ring onto the card now that the link no longer
    // wraps it. Height stretches so cards in a row match when a handle wraps.
    <article className="bd-disccard focus-within:ring">
      {/* The whole-card hit target. It covers the card instead of wrapping it
          because an `<a>` inside an `<a>` is invalid HTML — the browser closes
          the outer one early and the TikTok link ends up outside the card
          (KAN-200). Empty, so it needs an `aria-label`: the handle is the only
          name a screen reader could announce it by. */}
      {href && (
        <Link
          href={href}
          aria-label={creator.tiktokHandle}
          className="absolute inset-0 rounded-2xl"
        />
      )}
      <div className="bd-dischead">
        <InitialsAvatar name={creator.tiktokHandle} image={creator.image} />
        <div className="bd-discid">
          <TruncatedText
            text={`@${creator.tiktokHandle.replace(/^@+/, '')}`}
            className="bd-dischandle"
          />
          <span className="bd-discniche">
            {NICHE_LABELS[creator.niche as Niche] ?? creator.niche}
          </span>
        </div>
        {/* The tier name is context for the price beside it, not a fact a
            brand filters on, so it reads as a label rather than a figure. */}
        <span className="bd-disctier">{creator.tierName}</span>
      </div>

      {/* Absent is not zero. Both optional figures come from
          `lib/creators/profile-facts.ts`, which is also what the creator's
          own dashboard renders them through, so a blank optional field
          cannot read as a claim on one screen and a gap on the other. */}
      <dl className="bd-discfacts">
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
          className={cn('relative z-10 bd-disctiktok', textLinkFeedback)}
        >
          <TiktokLogo size={14} weight="regular" aria-hidden />
          {VIEW_ON_TIKTOK_LABEL}
          <ArrowSquareOut size={12} weight="regular" aria-hidden />
        </a>
      )}
    </article>
  );
}
