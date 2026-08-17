import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CampaignBriefForm } from '@/components/campaign/campaign-brief-form';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { getCampaignForBrand } from '@/lib/campaigns/queries';

export const runtime = 'nodejs';

/**
 * Campaign edit page for brands (KAN-26).
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
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <PageHeader
        label="Campaign brief"
        title="Edit campaign brief"
        description="Update the budget, target video count, or brief details for this campaign."
      />

      {!isEditable ? (
        <div className="flex flex-col gap-8">
          <Alert variant="destructive">
            <AlertTitle>Campaign cannot be edited</AlertTitle>
            <AlertDescription>
              This campaign is in &ldquo;{campaign.status}&rdquo; status. Once a
              campaign is confirmed or funded, its brief parameters are locked.
            </AlertDescription>
          </Alert>

          <Link
            href="/campaigns"
            className={buttonVariants({ variant: 'outline', size: 'default' })}
          >
            Back to campaigns
          </Link>
        </div>
      ) : (
        <CampaignBriefForm mode="edit" campaign={campaign} />
      )}
    </div>
  );
}
