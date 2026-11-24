import { redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { BrandOnboardingForm } from './brand-onboarding-form';

/**
 * Brand onboarding (KAN-27, FR-001, AC-1) — the v4 visual language: the
 * form rides the brief-card shell, the guidance sits in the rail grammar.
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
    <BdShell>
      <BdPageHead
        eyebrow="Brand setup"
        title="Set up your brand profile"
        facts="Add the name creators will see when you send an offer. You can change it later."
        ruled
      />

      <div
        className="bd-briefsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <section className="bd-briefcard">
          <BrandOnboardingForm />
        </section>

        <aside className="bd-caprail bd-briefrail">
          <div className="bd-railcell">
            <span className="bd-railk">One detail to get started</span>
            <span className="bd-railn">
              Use the name creators will recognise. Your campaign workspace
              comes next.
            </span>
          </div>
          <p className="bd-railfoot">
            Creators see this name on every offer you send.
          </p>
        </aside>
      </div>
    </BdShell>
  );
}
