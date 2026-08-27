import { redirect } from 'next/navigation';
import { ArrowSquareOut, TiktokLogo } from '@phosphor-icons/react/dist/ssr';
import { AudienceSection } from '@/components/creator/audience-section';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { DealGroups } from '@/components/creator/deal-groups';
import { EarningsSummary } from '@/components/creator/earnings-summary';
import { TierPricing } from '@/components/creator/tier-pricing';
import { VerificationStatus } from '@/components/creator/verification-status';
import { EmptyState } from '@/components/feedback/empty-state';
import { SectionLabel } from '@/components/layout/section-label';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { requireRole } from '@/lib/auth';
import {
  ENGAGEMENT_RATE_HINT,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import {
  NOT_BOOKABLE_DESCRIPTION,
  NOT_BOOKABLE_TITLE,
  NO_DEALS_DESCRIPTION,
  NO_DEALS_TITLE,
  readCreatorDashboard,
} from '@/lib/creators/dashboard';
import {
  VIEW_ON_TIKTOK_LABEL,
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { readAudience } from '@/lib/creators/detail';
import { tiktokProfileUrl } from '@/lib/creators/handle';
import { getCreatorProfileWithTier, isBookable } from '@/lib/creators/queries';
import { listTierCandidates, selectTier } from '@/lib/creators/tier-assignment';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Creator dashboard (KAN-25, US-001; laid out as one on KAN-200).
 *
 * One place for the three things a creator runs their side of the marketplace
 * from: where their verification stands and what they are priced at (AC-1),
 * what deals they have and what state each is in (AC-2), and what they have
 * been paid (AC-3).
 *
 * A creator with no profile has nothing to see here, so this is also the funnel
 * into onboarding: signing up lands on `/creator`, which sends them straight to
 * the form (US-001).
 *
 * Both reads gate themselves. `requireRole` below is the navigation gate — it
 * redirects rather than throws, which is the right behaviour for someone who
 * followed a link — and `readCreatorDashboard` runs `guard` again inside the
 * module and resolves the creator's own profile id from the session. AC-6 is
 * that second layer's: this page cannot ask for anyone else's deals because the
 * function takes no id to ask with (NFR-005).
 *
 * **Two columns, and which side a thing goes on is the point (KAN-200).** This
 * was seven `border-t` sections stacked in a `max-w-2xl` column, in submission
 * order — profile facts, audience, pricing, earnings, deals — so a creator
 * checking on a deal scrolled past everything they had already told us. It read
 * as a filled-in form. The structure now follows `(brand)/brand/page.tsx`, which
 * is the in-repo precedent: `PageHeader`, teal section labels, and **work on the
 * left, reference on the right** — money and deals are what changes without the
 * creator doing anything, and their own profile is what does not.
 *
 * One column below `lg:`, with the work first (NFR-007). On a phone the
 * right-hand column falls underneath rather than beside, which is the correct
 * order for the same reason it is the correct side.
 */
export default async function CreatorDashboardPage() {
  const user = await requireRole('creator');

  const row = await getCreatorProfileWithTier(user.id);
  if (!row) redirect('/creator/onboarding');

  const { profile, tier } = row;

  const dashboard = await readCreatorDashboard();
  // Null means no profile row, which the redirect above has already ruled out.
  // Narrowing rather than asserting keeps that an ordinary branch.
  if (!dashboard) redirect('/creator/onboarding');

  // For an untiered creator, work out the tier they *would* be assigned on their
  // current numbers, so the pricing block can preview it instead of implying they
  // failed to qualify (tier assignment has simply not run yet — KAN-23). Reuses
  // the exact rule assignment uses, so the preview and the eventual assignment
  // agree. Skipped once tiered: the price then comes from the tier row.
  const provisional =
    tier === null ? selectTier(await listTierCandidates(), profile) : null;

  const bookable = isBookable({ ...profile, tierActive: tier?.active ?? null });
  const profileUrl = tiktokProfileUrl(profile.tiktokHandle);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 py-4">
      <VerificationStatus
        status={profile.status}
        tiktokHandle={profile.tiktokHandle}
        hasTier={profile.tierId !== null}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-start lg:gap-8">
        {/* Left: what moves. */}
        <div className="flex flex-col gap-5">
          {/* AC-3 and AC-2. Earnings first: a creator opening this page
              mid-campaign is usually here for the money, and the deal list
              explains it. Both figures are ledger sums (AC-4) — nothing on this
              page computes a payout. */}
          <section className="surface-card rounded-[28px] border border-neutral-200 p-5 shadow-[0_24px_60px_-40px_rgba(23,23,23,0.35)] sm:p-6">
            <EarningsSummary earnings={dashboard.earnings} />
          </section>

          <section className="rounded-[28px] border border-neutral-200 bg-neutral-50 p-5 sm:p-6">
            {/* AC-5. Two different empty states, because "no offers yet" is the
                wrong sentence for a creator who is not bookable: they are not
                waiting on a brand, they are waiting on verification or a tier,
                and there is nothing for them to do about it. `isBookable` is the
                same predicate discovery filters on, so the two cannot disagree
                about whether this creator is visible to brands. */}
            {dashboard.isEmpty ? (
              <EmptyState
                title={bookable ? NO_DEALS_TITLE : NOT_BOOKABLE_TITLE}
                description={
                  bookable ? NO_DEALS_DESCRIPTION : NOT_BOOKABLE_DESCRIPTION
                }
              />
            ) : (
              <DealGroups groups={dashboard.groups} />
            )}
          </section>
        </div>

        {/* Right: what the creator told us, and what it priced them at. */}
        <aside className="flex flex-col gap-5 lg:sticky lg:top-28">
          {/* Above the audience and the price on purpose: the tier is derived
              from these two numbers, so a creator reading down sees the inputs
              before the rate — and in the untiered case, the blank field the
              pricing block is about is directly above the sentence naming it. */}
          <section className="surface-card rounded-[24px] border border-neutral-200 p-5">
            <SectionLabel>Your profile</SectionLabel>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-6">
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Niche
                </dt>
                <dd className="text-sm">
                  {NICHE_LABELS[profile.niche as Niche] ?? profile.niche}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Followers
                </dt>
                {/* AC-027's rule generalises: an absent number is not zero. A
                    creator who skipped this optional field has not claimed no
                    followers. The rule lives in `profile-facts.ts` because the
                    brand-facing card renders the same two fields and must answer
                    null the same way. */}
                <dd className="font-mono text-sm">
                  {formatFollowerCount(profile.followerCount)}
                </dd>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Engagement rate
                </dt>
                <dd className="font-mono text-sm">
                  {formatEngagementRate(profile.engagementRate)}
                </dd>
                {/* The same sentence a brand filtering on this figure reads
                    (KAN-200). The creator is the one who reported it, so they are
                    the one who most needs to know what we asked for. */}
                <p className="text-xs leading-normal text-muted-foreground text-balance">
                  {ENGAGEMENT_RATE_HINT}
                </p>
              </div>
            </dl>
            {/* The account under all of this, as a brand sees it. Same link, same
                label and same `rel` as the discovery card (KAN-200). */}
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'mt-5 gap-1.5'
                )}
              >
                <TiktokLogo size={16} weight="regular" aria-hidden />
                {VIEW_ON_TIKTOK_LABEL}
                <ArrowSquareOut size={14} weight="regular" aria-hidden />
              </a>
            )}
          </section>

          {/* §11: The audience the creator submitted at onboarding — the same
              data brands see on the discovery detail page. Part of "who you
              are", not "what you earn", which is why it is on this side. */}
          <section className="surface-card rounded-[24px] border border-neutral-200 p-5">
            <AudienceSection audience={readAudience(profile.audience)} />
          </section>

          <section className="surface-card rounded-[24px] border border-neutral-200 p-5">
            <TierPricing
              tier={tier}
              profile={profile}
              status={profile.status}
              provisional={provisional}
            />
          </section>
        </aside>
      </div>

      <div className="flex items-center gap-3 border-t border-neutral-200 pt-8">
        <InitialsAvatar name={user.name ?? user.email} />
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name ?? user.email}.
        </p>
      </div>
    </div>
  );
}
