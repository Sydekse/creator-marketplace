import { redirect } from 'next/navigation';
import { TierPricing } from '@/components/creator/tier-pricing';
import { VerificationStatus } from '@/components/creator/verification-status';
import { requireRole } from '@/lib/auth';
import { NICHE_LABELS } from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import {
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { getCreatorProfileWithTier } from '@/lib/creators/queries';

/**
 * Creator dashboard.
 *
 * A creator with no profile has nothing to see here, so this is also the funnel
 * into onboarding: signing up lands on `/creator`, which sends them straight to
 * the form (US-001).
 */
export default async function CreatorDashboardPage() {
  const user = await requireRole('creator');

  const row = await getCreatorProfileWithTier(user.id);
  if (!row) redirect('/creator/onboarding');

  const { profile, tier } = row;

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

      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}. Deal offers and deliverables
        land here in a later ticket.
      </p>
    </div>
  );
}
