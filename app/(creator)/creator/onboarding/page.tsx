import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { requireRole } from '@/lib/auth';
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

  const profile = await getCreatorProfileByUserId(user.id);
  if (profile) redirect('/creator');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 py-4">
      <PageHeader
        label="Creator application"
        title="Tell brands who your audience is"
        description="Brands search by niche and audience, then send paid offers at your tier price. Everything here is what they see when they find you."
      />

      <CreatorOnboardingForm />
    </div>
  );
}
