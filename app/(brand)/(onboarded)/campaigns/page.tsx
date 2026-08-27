import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { CancelCampaignButton } from '@/components/campaign/cancel-campaign-button';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import { listCampaignsByBrand } from '@/lib/campaigns/queries';
import { TruncatedText } from '@/components/ui/truncated-text';
import { formatEtb } from '@/lib/money';

export const runtime = 'nodejs';

/**
 * Campaigns list page for brands (KAN-26, US-003, AC-007).
 *
 * Every campaign the brand owns, whatever its status — a confirmed campaign is
 * still theirs, and a draft-only list would drop it from view the moment they
 * sent its offers.
 */
export default async function CampaignsPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const campaigns = await listCampaignsByBrand(profile.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeader
        label="Brand workspace"
        title="Campaigns"
        description="Manage your campaign briefs and review creator commitments."
        action={
          <Link
            href="/campaigns/new"
            className={buttonVariants({ variant: 'default', size: 'default' })}
          >
            New campaign
          </Link>
        }
      />

      {campaigns.length === 0 ? (
        <EmptyState
          align="start"
          title="No campaigns yet"
          description="Create your first campaign brief with a budget and goals to start discovering and booking creators."
          action={
            <Link
              href="/campaigns/new"
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              Create your first campaign
            </Link>
          }
        />
      ) : (
        <section className="border-y border-neutral-200">
          <div className="flex items-center justify-between gap-4 bg-neutral-100/45 px-4 py-3 sm:px-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
              Campaign ledger
            </p>
            <p className="text-xs text-muted-foreground">
              {campaigns.length}{' '}
              {campaigns.length === 1 ? 'campaign' : 'campaigns'}
            </p>
          </div>
          <ul>
            {campaigns.map((camp) => (
              <li key={camp.id} className="border-b border-neutral-200">
                <div className="grid gap-5 px-1 py-5 transition-colors hover:bg-neutral-100/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <h2 className="min-w-0 flex-1 text-base font-semibold text-neutral-900">
                        <TruncatedText text={camp.name} />
                      </h2>
                      <Chip
                        tone={campaignStatusTone[camp.status] ?? 'gray'}
                        className="capitalize"
                      >
                        {campaignStatusLabel(camp.status)}
                      </Chip>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created on{' '}
                      {new Date(camp.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs text-muted-foreground">
                          Budget
                        </dt>
                        <dd className="font-mono text-sm text-neutral-900">
                          {formatEtb(camp.budget)}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs text-muted-foreground">
                          Deliverables
                        </dt>
                        <dd className="text-sm text-neutral-900">
                          {camp.desiredVideos}{' '}
                          {camp.desiredVideos === 1 ? 'video' : 'videos'}
                        </dd>
                      </div>
                    </dl>
                    {camp.goal && (
                      <p className="mt-3 line-clamp-2 max-w-2xl text-sm text-muted-foreground">
                        {camp.goal}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {/*
                      A confirmed campaign has no brief to edit — the edit page
                      answers with a "cannot be edited" alert and a way back.
                      Sending them to the campaign itself is the useful link
                      once offers are out, and this list only shows non-draft
                      campaigns at all because confirmation exists.

                      Cancel sits beside Edit for drafts — the two things a
                      brand does to a brief that has no offers yet. It is the
                      same CancelCampaignButton the detail page renders, in its
                      `list` context so success refreshes the row rather than
                      navigating to the page the brand is already on.
                    */}
                    {camp.status === 'draft' ? (
                      <>
                        <Link
                          href={`/campaigns/${camp.id}/edit`}
                          className={buttonVariants({
                            variant: 'outline',
                            size: 'sm',
                          })}
                        >
                          Edit brief
                        </Link>
                        <CancelCampaignButton
                          campaignId={camp.id}
                          campaignName={camp.name}
                          context="list"
                        />
                      </>
                    ) : (
                      <Link
                        href={`/campaigns/${camp.id}`}
                        className={buttonVariants({
                          variant: 'outline',
                          size: 'sm',
                        })}
                      >
                        View campaign
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
