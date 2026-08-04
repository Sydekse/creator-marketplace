import { redirect } from 'next/navigation';
import { VerificationStatus } from '@/components/creator/verification-status';
import { requireRole } from '@/lib/auth';
import { NICHE_LABELS } from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import { getCreatorProfileByUserId } from '@/lib/creators/queries';

/**
 * Creator dashboard.
 *
 * A creator with no profile has nothing to see here, so this is also the funnel
 * into onboarding: signing up lands on `/creator`, which sends them straight to
 * the form (US-001).
 */
export default async function CreatorDashboardPage() {
  const user = await requireRole('creator');

  const profile = await getCreatorProfileByUserId(user.id);
  if (!profile) redirect('/creator/onboarding');

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
              who skipped this optional field has not claimed no followers. */}
          <dd className="font-mono text-sm">
            {profile.followerCount === null
              ? 'Not provided'
              : profile.followerCount.toLocaleString('en-US')}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
            Engagement rate
          </dt>
          <dd className="font-mono text-sm">
            {profile.engagementRate === null
              ? 'Not provided'
              : `${profile.engagementRate}%`}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
            Tier
          </dt>
          <dd className="text-sm">
            {profile.tierId === null ? 'Not yet assigned' : 'Assigned'}
          </dd>
        </div>
      </dl>

      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}. Deal offers and deliverables
        land here in a later ticket.
      </p>
    </div>
  );
}
