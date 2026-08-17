import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCartForm } from '@/components/campaign/add-to-cart-form';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listDraftCampaignsByBrand } from '@/lib/campaigns/queries';

import { NICHE_LABELS } from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';

import { readCreatorDetail } from '@/lib/creators/detail';
import type { CreatorAudience } from '@/lib/creators/detail';
import {
  NOT_PROVIDED,
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

/**
 * The audience breakdown. Every value here is already a display string —
 * `readAudience` resolved the market codes and kept anything it did not
 * recognise verbatim, so nothing below can render `undefined`.
 *
 * An empty breakdown answers with `NOT_PROVIDED`, the same constant the two
 * optional metrics use. A creator who never filled this in has not told a brand
 * their audience is nobody, and one screen saying "None" while another says
 * "Not provided" about the same kind of gap is how that distinction erodes.
 */
function Audience({ audience }: { audience: CreatorAudience }) {
  const { markets, ageRange } = audience;

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
        Audience
      </h2>
      <dl className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Top markets</dt>
          <dd className="text-sm">
            {markets.length > 0 ? markets.join(', ') : NOT_PROVIDED}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Age range</dt>
          <dd className="text-sm">{ageRange ?? NOT_PROVIDED}</dd>
        </div>
      </dl>
    </section>
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      {/* Cannot carry the brand's filters back: this page never sees them, and
          threading a `?return=` round-trip through the card is scope this ticket
          does not own. */}
      <Link
        href="/discover"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to results
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="page-title">{creator.tiktokHandle}</h1>
        <p className="text-sm text-muted-foreground">
          {NICHE_LABELS[creator.niche as Niche] ?? creator.niche}
        </p>
      </div>

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
        />
        <Fact
          label={`Per video · ${creator.tierName}`}
          value={formatEtb(creator.pricePerVideo)}
        />
      </dl>

      <Audience audience={creator.audience} />

      <AddToCartForm
        creatorId={creator.id}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
