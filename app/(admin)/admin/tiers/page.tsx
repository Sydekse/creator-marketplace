import Link from 'next/link';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
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
 *
 * v4 conversion: admin shell, section rulers, and v4 table/form chrome around
 * the existing assignment client components.
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
    <BdShell className="bd-ad bd-ad-tiers">
      <BdPageHead
        eyebrow="Admin console"
        title="Awaiting tier"
        facts={
          <>
            <span className="bd-mono">{flaggedRows.length}</span> flagged ·{' '}
            <span className="bd-mono">{creators.length}</span> awaiting tier ·
            Correct numbers, then retry assignment.
          </>
        }
        ruled
      />

      {/* Flagged before awaiting: these creators hold a live price that their
          numbers no longer support, which is the more urgent of the two lists. */}
      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Flagged for review</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {flaggedRows.length}
            {flagged.hasMore ? '+' : ''} flagged
          </span>
        </div>
        <FlaggedReviewList rows={flaggedRows} />
      </section>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Unbookable creators</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {creators.length} on this page
          </span>
        </div>
        <AwaitingTierList creators={creators} />
      </section>

      {/* Shown whenever there is anywhere to go, including from a page past the
          end — otherwise an admin who lands on `?page=9` after the list drained
          reads the empty state as "nobody is stuck". */}
      {(page > 1 || hasMore) && (
        <div className="bd-ad-pager">
          <p>
            {creators.length > 0
              ? `Showing ${offset + 1}–${offset + creators.length}`
              : `Nothing on page ${page}`}
          </p>
          <div>
            {page > 1 && (
              <Link
                href={`/admin/tiers?page=${page - 1}`}
                className="bd-btn bd-btn--ghost"
              >
                Previous
              </Link>
            )}
            {hasMore && (
              <Link
                href={`/admin/tiers?page=${page + 1}`}
                className="bd-btn bd-btn--ghost"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </BdShell>
  );
}
