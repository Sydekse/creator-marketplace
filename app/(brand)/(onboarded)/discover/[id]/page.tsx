import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowSquareOut,
  TiktokLogo,
} from '@phosphor-icons/react/dist/ssr';
import { AddToCartForm } from '@/components/campaign/add-to-cart-form';
import { AudienceSection } from '@/components/creator/audience-section';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { MagneticAnchor } from '@/components/motion/magnetic-anchor';
import { StaggerIn } from '@/components/motion/stagger-in';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listDraftCampaignsByBrand } from '@/lib/campaigns/queries';
import {
  ENGAGEMENT_RATE_HINT,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import { readCreatorDetail } from '@/lib/creators/detail';
import { cn, textLinkFeedback } from '@/lib/utils';
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
 * (KAN-29, US-004, AC-012).
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
    <div className="flex flex-col gap-2 px-0 py-5 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <dt className="text-[11px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
        {label}
      </dt>
      <dd className="font-mono text-2xl font-medium tracking-tight text-neutral-900 tabular-nums">
        {value}
      </dd>
      {hint ? (
        <p className="max-w-[36ch] text-xs leading-relaxed text-neutral-500">
          {hint}
        </p>
      ) : null}
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
    <StaggerIn className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Link
        href="/discover"
        className={cn(
          'inline-flex w-fit items-center gap-2 text-sm text-neutral-500',
          textLinkFeedback
        )}
      >
        <ArrowLeft size={16} weight="regular" aria-hidden />
        Back to results
      </Link>

      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-10">
          <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <InitialsAvatar
              name={creator.tiktokHandle}
              size="lg"
              className="size-16 border-neutral-200 bg-neutral-50 text-lg sm:size-20"
            />
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
                Creator
              </p>
              <h1 className="page-title">{handle}</h1>
              <p className="text-sm text-neutral-600">
                {NICHE_LABELS[creator.niche as Niche] ?? creator.niche}
                <span className="text-neutral-400"> · </span>
                {creator.tierName}
              </p>
              {profileUrl ? (
                <MagneticAnchor
                  href={profileUrl}
                  className="btn-shine mt-1 inline-flex w-fit items-center gap-2 rounded-full border border-neutral-300 bg-neutral-50 px-4 py-2 text-[13px] font-medium text-neutral-900 transition-[transform,border-color,background-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-500 hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  <TiktokLogo size={16} weight="regular" aria-hidden />
                  {VIEW_ON_TIKTOK_LABEL}
                  <ArrowSquareOut size={14} weight="regular" aria-hidden />
                </MagneticAnchor>
              ) : null}
            </div>
          </header>

          <dl className="grid grid-cols-1 divide-y divide-neutral-200 border-y border-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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

          <AudienceSection audience={creator.audience} title="Audience" />
        </div>

        <div className="lg:sticky lg:top-24">
          <AddToCartForm
            creatorId={creator.id}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
      </div>
    </StaggerIn>
  );
}
