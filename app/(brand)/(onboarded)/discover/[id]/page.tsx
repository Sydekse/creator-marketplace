import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCartForm } from '@/components/campaign/add-to-cart-form';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listDraftCampaignsByBrand } from '@/lib/campaigns/queries';

import {
  ENGAGEMENT_RATE_HINT,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';

import { AudienceSection } from '@/components/creator/audience-section';
import { readCreatorDetail } from '@/lib/creators/detail';
import { cn, textLinkFeedback } from '@/lib/utils';
import { tiktokProfileUrl } from '@/lib/creators/handle';
import {
  VIEW_ON_TIKTOK_LABEL,
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { formatEtb } from '@/lib/money';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One creator's profile, for a brand deciding whether to shortlist them
 * (KAN-29, US-004, AC-012).
 *
 * A route rather than a modal over the results. Tech spec §4 defines no
 * per-creator endpoint, so a client-side sheet would have nothing to fetch from;
 * a route reads on the server, ships no client JavaScript, and makes a creator
 * shareable and bookmarkable the way a filtered list already is.
 *
 * Inside `(onboarded)`, so the layout there gates a brand with no profile
 * without this file remembering to. The role gate and the bookable rule are both
 * `readCreatorDetail`'s — a creator who is pending, rejected or un-tiered is not
 * reachable by typing their id, and every kind of miss lands on the same
 * `not-found.tsx` beside this file (AC-006).
 *
 * `params` is a Promise and has to be awaited — that is the Next 16 shape, per
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
 */

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  /**
   * A sentence saying what the figure means, when the label alone does not say
   * (KAN-200). Rendered as visible text under the value rather than a tooltip —
   * hover-only copy tells a touch user nothing.
   */
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-sm">{value}</dd>
      {hint && (
        <p className="text-xs leading-normal text-muted-foreground text-balance">
          {hint}
        </p>
      )}
    </div>
  );
}

export default async function CreatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const creator = await readCreatorDetail(id);
  if (!creator) notFound();

  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  const campaigns = profile ? await listDraftCampaignsByBrand(profile.id) : [];

  // `null` for a handle no longer storable, which renders no link rather than a
  // broken one. See `tiktokProfileUrl`.
  const profileUrl = tiktokProfileUrl(creator.tiktokHandle);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 py-4">
      {/* Cannot carry the brand's filters back: this page never sees them, and
          threading a `?return=` round-trip through the card is scope this ticket
          does not own. */}
      <Link
        href="/discover"
        className={cn('text-sm text-muted-foreground', textLinkFeedback)}
      >
        ← Back to results
      </Link>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 sm:gap-6">
        <div className="pt-1">
          <InitialsAvatar name={creator.tiktokHandle} size="lg" />
        </div>
        <PageHeader
          title={creator.tiktokHandle}
          description={NICHE_LABELS[creator.niche as Niche] ?? creator.niche}
          className="flex-1"
        />
      </div>

      {/* Every figure below is self-reported and verification is manual, so the
          profile itself is the only primary source a brand has before it commits
          money (KAN-200). A plain `<a>`: this page is not wrapped in a `<Link>`,
          and `next/link` is for in-app routes. `noopener noreferrer` so the tab
          we open gets no handle on ours, `nofollow` because we are not vouching
          for an account nobody has checked. */}
      {profileUrl && (
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: 'self-start',
          })}
        >
          {VIEW_ON_TIKTOK_LABEL} ↗
        </a>
      )}

      {/* Two columns on a phone, three from `sm:` up (NFR-007). The price is
          read straight off the joined tier row — no arithmetic on this path, so
          it cannot diverge from what the creator is shown on `/creator`
          (AC-005). */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        <Fact
          label="Followers"
          value={formatFollowerCount(creator.followerCount)}
        />
        <Fact
          label="Engagement rate"
          value={formatEngagementRate(creator.engagementRate)}
          hint={ENGAGEMENT_RATE_HINT}
        />
        <Fact
          label={`Per video · ${creator.tierName}`}
          value={formatEtb(creator.pricePerVideo)}
        />
      </dl>

      <div className="border-t border-border pt-8">
        <AudienceSection audience={creator.audience} />
      </div>

      <AddToCartForm
        creatorId={creator.id}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
