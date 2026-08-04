import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';

/**
 * The profile gate — KAN-27 AC-1 and AC-4.
 *
 * AC-4 says a brand with no profile is "redirected to onboarding rather than
 * shown a broken campaign screen". The campaign screens are KAN-29 and KAN-30
 * and do not exist yet, which is exactly why this lives in a layout instead of
 * in each page: a redirect written per-page is a rule every future brand route
 * has to remember, and AC-4 describes the one that forgets.
 *
 * `(onboarded)` is a route group, so it adds nothing to any URL. Everything
 * inside it — `/brand` today, `/campaigns` and `/discover` when they land — is
 * unreachable without a profile. **New brand routes go inside this group.** The
 * onboarding page itself sits outside it, in `app/(brand)/brand/onboarding`,
 * because a gate that redirected to its own destination would loop.
 *
 * The role gate above this (in `app/(brand)/layout.tsx`) still runs first; this
 * only adds the profile condition. It is a navigation convenience and not the
 * access control — mutations are guarded server-side in their own handlers.
 */
export default async function OnboardedBrandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole('brand');

  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  return <>{children}</>;
}
