import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { BrandOnboardingForm } from './brand-onboarding-form';

/**
 * Brand onboarding (KAN-27, FR-001, AC-1).
 *
 * Deliberately outside the `(onboarded)` group — this is the page that group
 * redirects to, so gating it on having a profile would loop.
 *
 * The redirect below is the opposite case and is a convenience, not a control:
 * `brand_profile.user_id` is unique, so a brand who reaches the endpoint
 * directly gets a 409 whatever this page does (AC-2). Sending them onward just
 * means they never see a form that cannot succeed.
 */
export default async function BrandOnboardingPage() {
  const user = await requireRole('brand');

  const profile = await getBrandProfileByUserId(user.id);
  if (profile) redirect('/brand');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 py-4">
      <PageHeader
        label="Brand setup"
        title="Who are you offering deals as?"
        description="Creators see this name on every offer you send, so use the one they would recognise. You can change it later."
      />

      <BrandOnboardingForm />
    </div>
  );
}
