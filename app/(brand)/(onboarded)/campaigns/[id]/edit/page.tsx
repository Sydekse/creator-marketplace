import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { CampaignBriefForm } from '@/components/campaign/campaign-brief-form';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { getCampaignForBrand } from '@/lib/campaigns/queries';
import { campaignStatusLabel } from '@/lib/campaigns/status';

export const runtime = 'nodejs';

/**
 * Campaign edit page for brands (KAN-26) — the v4 visual language, sharing
 * the create page's `.bd-briefcard` shell so the two brief surfaces read as
 * one. Locked campaigns get the v4 ghost state instead of an alert box: the
 * lock is an expected lifecycle fact, not an error.
 */
export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const campaign = await getCampaignForBrand(id, profile.id);
  if (!campaign) {
    notFound();
  }

  const isEditable = campaign.status === 'draft';

  return (
    <BdShell>
      <BdPageHead
        title="Edit campaign brief"
        facts={
          <>
            <b>{campaign.name}</b> · update the budget, target video count, or
            brief details
          </>
        }
        ruled
      />

      {!isEditable ? (
        <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2.5" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <h3>This brief is locked.</h3>
            <p>
              {campaign.name} is {campaignStatusLabel(campaign.status)}. Once a
              campaign is confirmed or funded, its brief parameters cannot
              change.
            </p>
            <Link className="bd-btn bd-btn--ghost" href="/campaigns">
              Back to campaigns
            </Link>
          </div>
        </div>
      ) : (
        <div
          className="bd-briefsplit bd-briefsplit--solo bd-rise"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <section className="bd-briefcard">
            <CampaignBriefForm mode="edit" campaign={campaign} />
          </section>
        </div>
      )}
    </BdShell>
  );
}
