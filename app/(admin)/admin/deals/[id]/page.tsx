import Link from 'next/link';
import { DeadlineSection } from '@/components/deals/deadline-section';
import { notFound } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
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
 *
 * v4 conversion: shared admin shell and framed audit trail, with history reads
 * and URL campaign context untouched.
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
    [events, evidence] = await Promise.all([
      getDealHistory(id),
      readVideoEvidence(id),
    ]);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <BdShell className="bd-ad bd-ad-dealhistory">
      <Link
        href="/admin/worklist"
        className={cn('bd-cdback', textLinkFeedback)}
      >
        ← Dispute worklist
      </Link>
      <BdPageHead
        eyebrow="Admin console"
        title="Deal history"
        facts={
          <>
            {campaignName ? `Campaign: ${campaignName} · ` : ''}
            <span className="bd-mono">{events.length}</span> state transitions
          </>
        }
        ruled
        rise={1}
      />

      <div
        className="bd-ad-historybox bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
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
        <Link href="/admin" className="bd-btn bd-btn--ghost">
          Back to the console
        </Link>
      </div>
    </BdShell>
  );
}
