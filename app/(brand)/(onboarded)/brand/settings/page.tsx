import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { BrandSettingsForm } from './brand-settings-form';

/**
 * Brand settings — KAN-27 AC-5, "the brand can edit their company name later".
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
    <div className="mx-auto flex max-w-2xl flex-col gap-10 py-4">
      <header className="flex flex-col gap-3">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Settings
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Brand profile
        </h1>
        <p className="text-muted-foreground">
          Creators see this name on every offer you send, including offers you
          have already sent.
        </p>
      </header>

      <BrandSettingsForm
        brandProfileId={profile.id}
        companyName={profile.companyName}
      />
    </div>
  );
}
