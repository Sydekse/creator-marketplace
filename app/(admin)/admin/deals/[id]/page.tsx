import Link from 'next/link';
import { DeadlineSection } from '@/components/deals/deadline-section';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { DealHistory } from '@/components/deals/deal-history';
import { getDealHistory } from '@/lib/deals/queries';
import { ForbiddenError } from '@/lib/authz';
import { cn, textLinkFeedback } from '@/lib/utils';
import { readVideoEvidence } from '@/lib/deliverables/read-history';
import { VideoHistory } from '@/components/deals/video-history';
import { MetricsForm } from '@/components/deals/metrics-form';
import { ResolveDisputeForm } from '@/components/admin/resolve-dispute-form';
import { REVISION_CATEGORY_LABELS } from '@/lib/deliverables/evidence';
import { labelForReviewStatus } from '@/lib/deals';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin deal drill-down (KAN-78): one deal's full event history.
 *
 * The read is `getDealHistory` with its default deps — the same read the
 * creator and brand pages use, whose `requireAccess` admits admins
 * (`allowAdmin: true`), so this page is the admin-facing window onto the
 * append-only `deal_event` trail (FR-007, NFR-012). The `(admin)` layout's
 * role gate and the read's own gate both apply.
 *
 * `getDealHistory` throws `ForbiddenError` for a malformed id (shape-checked
 * before the query, so a mistyped link is not a 500) and for a deal this
 * admin cannot see — which for an admin is no deal at all. A thrown
 * `ForbiddenError` on a nonexistent deal reads as a 404, not an oracle.
 */
export default async function AdminDealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ campaign?: string | string[] | undefined }>;
}) {
  const { id } = await params;
  // F2: the worklist links carry the campaign name so a drill-down has
  // context; a raw deep link (bookmark, pasted URL) still renders the trail,
  // just without the name — the read contract is untouched either way.
  const rawCampaign = (await searchParams).campaign;
  const campaignName =
    typeof rawCampaign === 'string' ? rawCampaign : undefined;

  let events;
  let evidence;
  try {
    events = await getDealHistory(id);
    evidence = await readVideoEvidence(id);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/worklist"
          className={cn('text-sm text-muted-foreground', textLinkFeedback)}
        >
          ← Dispute worklist
        </Link>
        <PageHeader
          label="Deal audit trail"
          title="Deal history"
          description={
            <>
              {campaignName ? `Campaign: ${campaignName}. ` : ''}
              Every state transition this deal has been through, oldest first.
            </>
          }
        />
      </div>

      <div className="border-y border-neutral-200 bg-neutral-100/35 px-4 py-5 sm:px-6">
        <DealHistory events={events} />
      </div>
      <DeadlineSection dealId={id} />
      {evidence.videos.map((video) => (
        <section
          key={video.id}
          className="flex flex-col gap-3 rounded-xl border p-5"
        >
          <h2 className="font-medium">
            Video {video.videoOrdinal} · Version {video.submissionVersion}
          </h2>
          <p>{labelForReviewStatus(video.reviewStatus)}</p>
          <a
            href={video.tiktokUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline"
          >
            Current TikTok link
          </a>
          {video.revisionCategory && (
            <p>{REVISION_CATEGORY_LABELS[video.revisionCategory]}</p>
          )}
          {video.rejectionReason && <p>{video.rejectionReason}</p>}
          <VideoHistory
            events={evidence.events.filter(
              (event) => event.deliverableId === video.id
            )}
            limited={video.historyCompleteness === 'legacy_baseline'}
          />
          <MetricsForm
            key={`${video.id}-${video.submissionVersion}`}
            deliverableId={video.id}
            expectedVersion={video.submissionVersion}
          />
        </section>
      ))}
      {['funded', 'delivered', 'revision_requested'].includes(
        evidence.status
      ) && (
        <ResolveDisputeForm
          dealId={id}
          status={evidence.status}
          campaignName={campaignName ?? 'Deal'}
          displayedVideos={evidence.videos}
        />
      )}

      <div>
        <Link
          href="/admin"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Back to the console
        </Link>
      </div>
    </div>
  );
}
