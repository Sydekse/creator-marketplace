import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowSquareOut,
  TiktokLogo,
} from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { AddToCartForm } from '@/components/campaign/add-to-cart-form';
import { AudienceSection } from '@/components/creator/audience-section';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listDraftCampaignsByBrand } from '@/lib/campaigns/queries';
import {
  ENGAGEMENT_RATE_HINT,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import { readCreatorDetail } from '@/lib/creators/detail';
import { tiktokProfileUrl } from '@/lib/creators/handle';
import {
  VIEW_ON_TIKTOK_LABEL,
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { formatEtb } from '@/lib/money';

export const runtime = 'nodejs';

/**
 * One creator's profile, for a brand deciding whether to shortlist them
 * (KAN-29, US-004, AC-012) — the v4 visual language: the discovery card's
 * identity grammar scaled up, the fact ledger in big mono numerals, and the
 * add-to-campaign card riding the sticky rail column.
 */

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bd-cdfact">
      <dt className="bd-cdfactlab">
        {label}
        {hint ? (
          /* The definition rides an (i) beside the label — hover or focus
             reveals it, and the sentence stays in the DOM for readers. */
          <span className="bd-cdinfo" tabIndex={0} aria-label={hint}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5.5" />
              <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
            </svg>
            <span role="tooltip" className="bd-cdtip">
              {hint}
            </span>
          </span>
        ) : null}
      </dt>
      <dd className="bd-cdfactval bd-mono">{value}</dd>
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
  const profileUrl = tiktokProfileUrl(creator.tiktokHandle);
  const handle = `@${creator.tiktokHandle.replace(/^@+/, '')}`;

  return (
    <BdShell>
      <div className="bd-rise" style={{ '--i': 0 } as React.CSSProperties}>
        <Link href="/discover" className="bd-cdback">
          <ArrowLeft size={16} weight="regular" aria-hidden />
          Back to results
        </Link>
      </div>

      <div
        className="bd-cdsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-cdmain">
          <header className="bd-cdhead">
            <InitialsAvatar
              name={creator.tiktokHandle}
              image={creator.image}
              size="lg"
              className="bd-cdavatar size-16 sm:size-20"
            />
            <div className="bd-cdid">
              <p className="bd-eyebrow">Creator</p>
              <h1 className="bd-h1">{handle}</h1>
              <p className="bd-idfacts bd-cdmeta">
                {NICHE_LABELS[creator.niche as Niche] ?? creator.niche}
                <span className="bd-disctier">{creator.tierName}</span>
                {profileUrl ? (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="bd-cdtiktok"
                  >
                    <TiktokLogo size={14} weight="regular" aria-hidden />
                    {VIEW_ON_TIKTOK_LABEL}
                    <ArrowSquareOut size={12} weight="regular" aria-hidden />
                  </a>
                ) : null}
              </p>
            </div>
          </header>

          <div className="bd-capruler">
            <span className="bd-caprulertitle">Track record</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulernote">
              Published figures from the creator&apos;s profile
            </span>
          </div>

          <dl className="bd-cdfacts">
            <Fact
              label="Followers"
              value={formatFollowerCount(creator.followerCount)}
            />
            <Fact
              label="Engagement rate"
              value={formatEngagementRate(creator.engagementRate)}
              hint={ENGAGEMENT_RATE_HINT}
            />
            <Fact label="Per video" value={formatEtb(creator.pricePerVideo)} />
          </dl>

          <div className="bd-capruler">
            <span className="bd-caprulertitle">Audience</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulernote">Who this creator reaches</span>
          </div>

          <div className="bd-cdaudience">
            <AudienceSection audience={creator.audience} title="Audience" />
          </div>
        </div>

        <aside className="bd-cdrail">
          <AddToCartForm
            creatorId={creator.id}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          />
        </aside>
      </div>
    </BdShell>
  );
}
