import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { needsCredentials, requireRole } from '@/lib/auth';
import { sessionTiktokHandle } from '@/lib/creators/credentials';
import { getCreatorProfileByUserId } from '@/lib/creators/queries';
import { CreatorOnboardingForm } from './creator-onboarding-form';

/**
 * Creator onboarding (US-001, AC-001).
 *
 * The redirect is a convenience, not a control: `creator_profile.user_id` is
 * unique, so a creator who reaches the endpoint directly gets a 409 regardless
 * of what this page does. Sending them to their dashboard just means they never
 * see a form that cannot succeed.
 */
export default async function CreatorOnboardingPage() {
  const user = await requireRole('creator');
  // Login Kit first, credentials second: a TikTok sign-up has no real email
  // until that step, so onboarding cannot start on the synthetic one.
  if (needsCredentials(user)) redirect('/creator/credentials');

  const profile = await getCreatorProfileByUserId(user.id);
  if (profile) redirect('/creator');

  return (
    <div className="mx-auto grid max-w-6xl gap-12 py-8 sm:py-12 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-start lg:gap-20 lg:py-16">
      <div className="lg:sticky lg:top-24 lg:pt-4">
        <PageHeader
          label="Creator application"
          title="Build your creator profile"
          description="Tell brands what you create and who watches it. Your profile becomes searchable after verification and tier assignment."
          className="max-w-xl"
        />
        <div className="mt-10 hidden border-l border-brand/40 pl-5 lg:block">
          <p className="text-sm font-semibold text-neutral-900">
            What brands will see
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-600">
            <li>TikTok account and niche</li>
            <li>Top audience markets and age</li>
            <li>Optional performance figures for tier review</li>
          </ul>
        </div>
      </div>

      <CreatorOnboardingForm
        lockedHandle={
          (await sessionTiktokHandle(user.id)) ?? user.tiktokHandle ?? null
        }
      />
    </div>
  );
}
