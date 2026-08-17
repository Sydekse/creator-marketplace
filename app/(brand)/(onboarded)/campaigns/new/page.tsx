import { CampaignBriefForm } from '@/components/campaign/campaign-brief-form';

export const runtime = 'nodejs';

/**
 * Brand campaign creation page (KAN-26, US-003, AC-007, AC-008).
 */
export default function NewCampaignPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Campaign brief
        </p>
        <h1 className="page-title">Create a campaign brief</h1>
        <p className="text-sm text-muted-foreground">
          Define your campaign parameters. Your brief will be saved as a draft,
          allowing you to add creators and confirm before funding.
        </p>
      </header>

      <CampaignBriefForm mode="create" />
    </div>
  );
}
