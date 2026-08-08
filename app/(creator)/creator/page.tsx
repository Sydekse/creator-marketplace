import { redirect } from 'next/navigation';
import { DealGroups } from '@/components/creator/deal-groups';
import { EarningsSummary } from '@/components/creator/earnings-summary';
import { TierPricing } from '@/components/creator/tier-pricing';
import { VerificationStatus } from '@/components/creator/verification-status';
import { EmptyState } from '@/components/feedback/empty-state';
import { requireRole } from '@/lib/auth';
import { NICHE_LABELS } from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import {
  NOT_BOOKABLE_DESCRIPTION,
  NOT_BOOKABLE_TITLE,
  NO_DEALS_DESCRIPTION,
  NO_DEALS_TITLE,
  readCreatorDashboard,
} from '@/lib/creators/dashboard';
import {
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { getCreatorProfileWithTier, isBookable } from '@/lib/creators/queries';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Creator dashboard (KAN-25, US-001).
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 py-4">
      <VerificationStatus
        status={profile.status}
        tiktokHandle={profile.tiktokHandle}
        hasTier={profile.tierId !== null}
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-border pt-8">
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
          {/* AC-027's rule generalises: an absent number is not zero. A creator
              who skipped this optional field has not claimed no followers. The
              rule lives in `profile-facts.ts` because the brand-facing card
              renders the same two fields and must answer null the same way. */}
          <dd className="font-mono text-sm">
            {formatFollowerCount(profile.followerCount)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
            Engagement rate
          </dt>
          <dd className="font-mono text-sm">
            {formatEngagementRate(profile.engagementRate)}
          </dd>
        </div>
      </dl>

      {/* Below the profile numbers on purpose: the tier is derived from them, so
          a creator reading top to bottom sees the inputs before the rate — and in
          the untiered case, the blank field this block is about is directly
          above the sentence naming it. */}
      <div className="border-t border-border pt-8">
        <TierPricing tier={tier} profile={profile} />
      </div>

      {/* AC-3 and AC-2. Earnings first: a creator opening this page mid-campaign
          is usually here for the money, and the deal list explains it. Both
          figures are ledger sums (AC-4) — nothing on this page computes a
          payout. */}
      <div className="border-t border-border pt-8">
        <EarningsSummary earnings={dashboard.earnings} />
      </div>

      <div className="border-t border-border pt-8">
        {/* AC-5. Two different empty states, because "no offers yet" is the
            wrong sentence for a creator who is not bookable: they are not
            waiting on a brand, they are waiting on verification or a tier, and
            there is nothing for them to do about it. `isBookable` is the same
            predicate discovery filters on, so the two cannot disagree about
            whether this creator is visible to brands. */}
        {dashboard.isEmpty ? (
          <EmptyState
            title={isBookable(profile) ? NO_DEALS_TITLE : NOT_BOOKABLE_TITLE}
            description={
              isBookable(profile)
                ? NO_DEALS_DESCRIPTION
                : NOT_BOOKABLE_DESCRIPTION
            }
          />
        ) : (
          <DealGroups groups={dashboard.groups} />
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}.
      </p>
    </div>
  );
}
