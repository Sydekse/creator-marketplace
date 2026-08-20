import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { BrandDealInbox } from '@/components/deals/brand-deal-inbox';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import {
  BRAND_INBOX_TITLE,
  BRAND_INBOX_DESCRIPTION,
  BRAND_NO_DEALS_TITLE,
  BRAND_NO_DEALS_DESCRIPTION,
  readBrandDealInbox,
} from '@/lib/deals/brand-inbox';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Brand deals inbox (§15).
 *
 * Every deal across all of the brand's campaigns, grouped by campaign.
 * Inside `(onboarded)`, so the layout there gates a brand with no profile.
 *
 * A brand reaches deal review only through this page or through the campaign
 * detail's performance cards. This is the "what needs my attention right now"
 * screen that groups by campaign rather than by status.
 */
export default async function BrandDealsPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const inbox = await readBrandDealInbox();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-4">
      <PageHeader
        title={BRAND_INBOX_TITLE}
        description={BRAND_INBOX_DESCRIPTION}
      />

      {inbox === null || inbox.isEmpty ? (
        <EmptyState
          title={BRAND_NO_DEALS_TITLE}
          description={BRAND_NO_DEALS_DESCRIPTION}
          action={
            <Link
              href="/discover"
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              Discover creators
            </Link>
          }
        />
      ) : (
        <BrandDealInbox campaigns={inbox.campaigns} />
      )}
    </div>
  );
}
