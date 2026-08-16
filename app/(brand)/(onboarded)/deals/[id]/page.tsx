import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { ReviewActions } from '@/components/deals/review-actions';
import { formatDeadlineUtc } from '@/lib/dates';
import { canReview, labelForStatus } from '@/lib/deals';
import {
  ALREADY_REVIEWED_MESSAGE,
  AWAITING_DELIVERABLE_MESSAGE,
  AWAITING_RESUBMISSION_MESSAGE,
  CREATOR_LABEL,
  DELIVERABLE_TITLE,
  NO_RIGHTS_TERMS_MESSAGE,
  REJECTION_REASON_LABEL,
  RIGHTS_TERMS_LABEL,
  SUBMITTED_AT_LABEL,
  TOTAL_PRICE_LABEL,
  UNIT_PRICE_LABEL,
  VIDEO_COUNT_LABEL,
  readBrandDeal,
} from '@/lib/deals/brand-detail';
import { formatEtb } from '@/lib/money';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One deal, for the brand deciding whether to approve it (KAN-68, US-008,
 * AC-023, AC-024).
 *
 * `params` is a Promise and has to be awaited — the Next 16 shape, per
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
 *
 * This route is what closes the loop. Wave 12 shipped `POST /approve` and
 * `POST /reject` with nothing anywhere that could call them, so every transition
 * in `fund -> deliver -> approve -> pay` existed in code while the chain could not
 * be walked in a browser. AC-023 and AC-024 both open with "given a brand reviews
 * a delivered video", which is this page.
 *
 * Lives at `/deals/[id]` rather than under `campaigns/[id]/` so the delivery
 * notification's CTA is one id deep — its payload carries a `dealId` and no
 * `campaignId`, so nesting would have meant changing the payload to build the
 * link. Inside `(onboarded)`, whose layout redirects a brand with no profile.
 *
 * Nothing here computes money. `formatEtb` is the only arithmetic-shaped call, and
 * the payout split is the ledger's to derive at approval time from the deal's own
 * snapshotted rate (invariant 8) — quoting an expected payout on this screen would
 * be a second source for a figure the transaction is about to compute.
 */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export default async function BrandDealReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deal = await readBrandDeal(id);
  if (!deal) notFound();

  const reviewable = canReview(deal.status);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <Link
        href={`/campaigns/${deal.campaignId}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to {deal.campaignName}
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {deal.creatorHandle}
        </h1>
        {/* The shared vocabulary from `lib/deals/groups.ts`, not a second set of
            words for the same nine statuses — its own docstring anticipates this
            screen, and two views naming one state differently is the kind of
            drift that is hard to notice. */}
        <div>
          <Badge variant="secondary">{labelForStatus(deal.status)}</Badge>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          <Fact label={CREATOR_LABEL} value={deal.creatorHandle} />
          <Fact label={VIDEO_COUNT_LABEL} value={String(deal.videoCount)} />
          <Fact label={UNIT_PRICE_LABEL} value={formatEtb(deal.unitPrice)} />
          <Fact label={TOTAL_PRICE_LABEL} value={formatEtb(deal.totalPrice)} />
          {/* AC-6 of KAN-35, which had no screen to live on until this one. The
              version stamped on the deal, never the one currently in effect: a
              deal is governed by the text its creator accepted, and a later
              republication must not change what a signed agreement says. */}
          <Fact
            label={RIGHTS_TERMS_LABEL}
            value={deal.rightsTermsVersion ?? NO_RIGHTS_TERMS_MESSAGE}
          />
        </dl>
      </section>

      {/* The deliverable itself. Shown as text rather than an embed or a preview:
          nothing on this page fetches the URL, so a hostile link cannot make the
          brand's browser talk to an arbitrary host (Tech Spec §6.3). The brand
          opens it deliberately, in a new tab, with `rel` set. */}
      {deal.deliverable ? (
        <section className="flex flex-col gap-2 rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{DELIVERABLE_TITLE}</h2>
          <a
            href={deal.deliverable.tiktokUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-mono text-sm break-all underline-offset-4 hover:underline"
          >
            {deal.deliverable.tiktokUrl}
          </a>
          <p className="text-sm text-muted-foreground">
            {SUBMITTED_AT_LABEL}:{' '}
            {formatDeadlineUtc(deal.deliverable.submittedAt)}
          </p>
          {/* AC-7 — what the brand asked for last time, so a resubmission can be
              read against it. Present only once a rejection has been recorded. */}
          {deal.deliverable.rejectionReason ? (
            <div className="flex flex-col gap-1 pt-2">
              <h3 className="text-sm font-medium">{REJECTION_REASON_LABEL}</h3>
              <p className="text-sm text-muted-foreground">
                {deal.deliverable.rejectionReason}
              </p>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          {AWAITING_DELIVERABLE_MESSAGE}
        </p>
      )}

      {/* AC-2 and AC-4. `canReview` reads `LEGAL_TRANSITIONS`, so these controls
          cannot outlive the edge that permits them — a status the machine stops
          accepting an approval from stops rendering them here with no edit to
          this file. Where they are absent the reason is a sentence beside them,
          never a `title=` tooltip, which tells a touch user nothing. */}
      {reviewable ? (
        <ReviewActions dealId={deal.id} />
      ) : deal.deliverable ? (
        <p className="text-sm text-muted-foreground">
          {deal.status === 'revision_requested'
            ? AWAITING_RESUBMISSION_MESSAGE
            : ALREADY_REVIEWED_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
