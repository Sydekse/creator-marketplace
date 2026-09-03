import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { BrandSettingsForm } from './brand-settings-form';

/**
 * Brand settings — KAN-27 AC-5, "the brand can edit their company name later".
 * Rendered in the v4 visual language, sharing the brief pages' form-card skin.
 *
 * Inside `(onboarded)`, so the layout has already established that a profile
 * exists; the non-null assertion below is that guarantee, not an assumption.
 * The read is repeated rather than passed down because a layout cannot hand
 * props to a page in the App Router.
 */
export default async function BrandSettingsPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);

  // Unreachable through the layout. Rendering nothing beats rendering a form
  // that would PATCH `undefined`.
  if (!profile) return null;

  return (
    <BdShell>
      <BdPageHead
        eyebrow="Settings"
        title="Brand profile"
        facts="Creators see this name on every offer you send, including offers you have already sent."
        ruled
      />

      <div
        className="bd-briefsplit bd-briefsplit--solo bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <section className="bd-briefcard">
          <BrandSettingsForm
            brandProfileId={profile.id}
            companyName={profile.companyName}
          />
        </section>
      </div>
    </BdShell>
  );
}
