import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
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
 * Brand deals inbox (§15) — the v4 visual language shared with the rest of
 * the brand workspace.
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
    <BdShell>
      <BdPageHead
        title={BRAND_INBOX_TITLE}
        facts={BRAND_INBOX_DESCRIPTION}
        actions={
          <Link className="bd-btn bd-btn--primary" href="/campaigns">
            View campaigns
          </Link>
        }
        ruled
      />

      {inbox === null || inbox.isEmpty ? (
        <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="7" width="16" height="13" rx="2.5" />
              <path d="M4 12h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
            </svg>
            <h3>{BRAND_NO_DEALS_TITLE}</h3>
            <p>{BRAND_NO_DEALS_DESCRIPTION}</p>
            <Link className="bd-btn bd-btn--primary" href="/discover">
              Discover creators
            </Link>
          </div>
        </div>
      ) : (
        <div
          className="bd-dealswrap bd-rise"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <BrandDealInbox campaigns={inbox.campaigns} />
        </div>
      )}
    </BdShell>
  );
}
