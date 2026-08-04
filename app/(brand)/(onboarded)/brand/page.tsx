import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';

/**
 * Brand dashboard.
 *
 * Reachable only through the `(onboarded)` layout, so a brand who lands here
 * has a profile; one who does not was already redirected to `/brand/onboarding`
 * (AC-4). The null branch below is type-narrowing, not a real state.
 */
export default async function BrandDashboardPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);

  if (!profile) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 py-4">
      <div className="flex flex-col gap-3 border-b border-border pb-8">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Offering deals as
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          {/* The company name leads because it is what creators see on every
              offer — a brand should be able to check it at a glance. */}
          <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">
            {profile.companyName}
          </h1>
          {/* A styled link, not a button: this navigates, so it must stay an
              <a> that middle-clicks and opens in a new tab. `buttonVariants`
              borrows the look without Base UI's button behaviour — `<Button
              render={<Link/>}>` would warn that `nativeButton` is true, and
              setting it false makes Base UI apply `role="button"`, announcing a
              link as a button. */}
          <Link
            href="/brand/settings"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Edit name
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}. Campaigns and creator discovery
        land here in a later ticket.
      </p>
    </div>
  );
}
