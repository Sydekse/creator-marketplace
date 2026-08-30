import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { readAwaitingTier } from '@/lib/creators/awaiting-tier';
import { readFlaggedForReview } from '@/lib/creators/flagged-review';
import { listTierCandidates, selectTier } from '@/lib/creators/tier-assignment';
import { PAGE_SIZE, offsetForPage, pageFromParam } from '@/lib/paging';
import { AwaitingTierList } from '@/components/admin/awaiting-tier-list';
import { FlaggedReviewList } from '@/components/admin/flagged-review-list';
import type { FlaggedReviewRow } from '@/components/admin/flagged-review-list';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Awaiting tier (KAN-23, AC-5).
 *
 * Verified creators who hold no tier, and therefore are not bookable. They
 * appear on no other screen: excluded from discovery, invisible elsewhere.
 * This page is what "surfaced to the admin rather than failing
 * silently" means in practice.
 *
 * Paging lives in the URL for the same reason it does on discovery
 * — this is a Server Component, so `?page=` is what re-runs the query, and
 * it survives the `router.refresh()` that follows every retry.
 */
export default async function AwaitingTierPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const page = pageFromParam((await searchParams).page);
  const offset = offsetForPage(page);
  const { creators, hasMore } = await readAwaitingTier({
    limit: PAGE_SIZE,
    offset,
  });

  // Flagged downgrades (phase 3). First page only — the flag is meant to be
  // acted on within a week (the next cron re-flags anyway), so a backlog deep
  // enough to page is itself the signal worth surfacing.
  const flagged = await readFlaggedForReview({ limit: PAGE_SIZE });
  // The suggestion is recomputed pure from the current numbers at render, the
  // same `selectTier` the assign route will run — so the label on the button
  // and the band the press produces cannot disagree. Tiers loaded once.
  const tierCandidates =
    flagged.creators.length > 0 ? await listTierCandidates() : [];
  const flaggedRows: FlaggedReviewRow[] = flagged.creators.map((creator) => ({
    creator,
    suggested: selectTier(tierCandidates, creator),
  }));

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        label="Pricing operations"
        title="Awaiting tier"
        description={
          <>
            Verified creators with no pricing tier. A creator is bookable only
            after verification and tier assignment, so these profiles do not
            appear in brand discovery. Correct their follower count or
            engagement rate, then retry assignment.
          </>
        }
      />

      {/* Flagged before awaiting: these creators hold a live price that their
          numbers no longer support, which is the more urgent of the two lists. */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4 border-y border-neutral-200 bg-neutral-100/45 px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
            Flagged for review
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {flaggedRows.length}
            {flagged.hasMore ? '+' : ''} flagged
          </p>
        </div>
        <FlaggedReviewList rows={flaggedRows} />
      </div>

      <div className="flex items-center justify-between gap-4 border-y border-neutral-200 bg-neutral-100/45 px-4 py-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
          Unbookable creators
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {creators.length} on this page
        </p>
      </div>

      <AwaitingTierList creators={creators} />

      {/* Shown whenever there is anywhere to go, including from a page past the
          end — otherwise an admin who lands on `?page=9` after the list drained
          reads the empty state as "nobody is stuck". */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {creators.length > 0
              ? `Showing ${offset + 1}–${offset + creators.length}`
              : `Nothing on page ${page}`}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/tiers?page=${page - 1}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Previous
              </Link>
            )}
            {hasMore && (
              <Link
                href={`/admin/tiers?page=${page + 1}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
