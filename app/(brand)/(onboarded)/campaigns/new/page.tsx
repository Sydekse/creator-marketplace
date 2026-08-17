import { CampaignBriefForm } from '@/components/campaign/campaign-brief-form';
import { PageHeader } from '@/components/layout/page-header';

export const runtime = 'nodejs';

/**
 * Brand campaign creation page (KAN-26, US-003, AC-007, AC-008).
 */
export default function NewCampaignPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <PageHeader
        label="Campaign brief"
        title="Create a campaign brief"
        description="Define your campaign parameters. Your brief will be saved as a draft, allowing you to add creators and confirm before funding."
      />

      <CampaignBriefForm mode="create" />
    </div>
  );
}
