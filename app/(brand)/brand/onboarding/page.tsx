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
    <div className="mx-auto grid max-w-5xl gap-12 py-8 sm:py-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-20 lg:py-20">
      <div className="lg:pt-4">
        <PageHeader
          label="Brand setup"
          title="Set up your brand profile"
          description="Add the name creators will see when you send an offer. You can change it later."
          className="max-w-xl"
        />
        <div className="mt-10 hidden border-l border-brand/60 pl-5 lg:block">
          <p className="text-sm font-semibold text-neutral-900">
            One detail to get started
          </p>
          <p className="mt-2 max-w-[30ch] text-sm leading-relaxed text-neutral-600">
            Use the name creators will recognise. Your campaign workspace comes
            next.
          </p>
        </div>
      </div>

      <BrandOnboardingForm />
    </div>
  );
}
