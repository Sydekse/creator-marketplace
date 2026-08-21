import { CampaignBriefForm } from '@/components/campaign/campaign-brief-form';
import { PageHeader } from '@/components/layout/page-header';

export const runtime = 'nodejs';

/**
 * Brand campaign creation page (KAN-26, US-003, AC-007, AC-008).
 */
export default function NewCampaignPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 py-4">
      <PageHeader
        label="Campaign brief"
        title="Create a campaign brief"
        description="Set the budget, deliverables, and goal. You can add creators before sending offers."
      />

      <CampaignBriefForm mode="create" />
    </div>
  );
}
