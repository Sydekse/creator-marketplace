'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { FlaggedReviewCreator } from '@/lib/creators/flagged-review';
import type { TierOutcome } from '@/lib/creators/tier-assignment';

/**
 * Creators whose refreshed stats suggested a downgrade (phase 3).
 *
 * A stats refresh never lowers a tier on its own — it stamps `tier_review_at`
 * and waits here for a human. Each row shows the tier the creator holds, the
 * numbers as of the last refresh, and the tier those numbers select *now*
 * (recomputed by the page, never stored). Two decisions per row:
 *
 * - **Apply suggested** — the existing assign-tier route: re-runs selection on
 *   the current numbers, writes the (lower) band, clears the flag.
 * - **Keep current tier** — the dismiss route: clears the flag, touches
 *   nothing else. A one-week dip stays dismissable; if it persists, the next
 *   cron run re-flags.
 */

/** What the page computed for this row: the flagged creator plus the pure
 * recompute of what their current numbers select. */
export interface FlaggedReviewRow {
  creator: FlaggedReviewCreator;
  suggested: TierOutcome;
}

function formatFollowerCount(count: number | null): string {
  if (count === null) return 'Not recorded';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function formatEngagementRate(rate: string | null): string {
  if (rate === null) return 'Not recorded';
  return `${parseFloat(rate).toFixed(1)}%`;
}

function formatDate(date: Date | null): string {
  if (date === null) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

function suggestedLabel(suggested: TierOutcome): string {
  if (suggested.assigned) return suggested.tierName;
  return suggested.reason === 'missing_data'
    ? 'No tier — numbers incomplete'
    : 'No tier — below every band';
}

function RowActions({ row }: { row: FlaggedReviewRow }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<'apply' | 'dismiss' | null>(
    null
  );
  const handle = row.creator.tiktokHandle.replace(/^@+/, '');

  async function post(path: string, kind: 'apply' | 'dismiss') {
    setSubmitting(kind);

    let response: Response;
    try {
      response = await fetch(path, { method: 'POST' });
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(null);
      return false;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(
        body?.error?.message ?? 'Something went wrong. Please try again.'
      );
      setSubmitting(null);
      return false;
    }

    // Reset before the refresh: a resolved row leaves this list, but a fetch
    // that raced another admin's decision keeps the instance mounted, and a
    // `submitting` left set would freeze both buttons.
    setSubmitting(null);
    router.refresh();
    return true;
  }

  async function handleApply() {
    const ok = await post(
      `/api/admin/creators/${encodeURIComponent(row.creator.id)}/assign-tier`,
      'apply'
    );
    if (ok) {
      toast.success(
        row.suggested.assigned
          ? `@${handle} moved to the ${row.suggested.tierName} tier`
          : `@${handle} reviewed — no band matched, current tier stands`
      );
    }
  }

  async function handleDismiss() {
    const ok = await post(
      `/api/admin/creators/${encodeURIComponent(row.creator.id)}/dismiss-review`,
      'dismiss'
    );
    if (ok) toast.success(`@${handle} keeps their current tier`);
  }

  return (
    <div className="bd-ad-tieractions">
      {/* Applying a no-match "suggestion" would keep the tier anyway (the
          assign route never clears one), so the button only appears when there
          is a band to move to — otherwise Dismiss is the whole decision. */}
      {row.suggested.assigned && (
        <Button size="sm" onClick={handleApply} disabled={submitting !== null}>
          {submitting === 'apply' ? (
            <Spinner className="size-3" />
          ) : (
            `Apply ${row.suggested.tierName}`
          )}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={handleDismiss}
        disabled={submitting !== null}
      >
        {submitting === 'dismiss' ? (
          <Spinner className="size-3" />
        ) : (
          'Keep current tier'
        )}
      </Button>
    </div>
  );
}

export function FlaggedReviewList({ rows }: { rows: FlaggedReviewRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bd-emptyfeed">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.5 6.5h13v11h-13z" />
          <path d="M8 10h8" />
          <path d="M8 13.5h5" />
          <path d="M16 13.5l2 2 3-4" />
        </svg>
        <h3>No downgrades waiting on review</h3>
        <p>
          Stats refreshes that suggest a lower tier land here for a decision.
          Nothing is flagged right now.
        </p>
      </div>
    );
  }

  return (
    <div className="bd-ad-ledgerframe bd-ad-tierframe">
      <div className="bd-ad-tiercols" aria-hidden="true">
        <span>Creator</span>
        <span>Current tier</span>
        <span>Followers</span>
        <span>Engagement</span>
        <span>Suggested</span>
        <span>Flagged</span>
        <span>Actions</span>
      </div>
      <ul className="bd-ad-ledgerlist">
        {rows.map((row) => (
          <li
            key={row.creator.id}
            className="bd-ad-tierrow bd-ad-workrow--wait"
          >
            <div className="bd-ad-tierrow-grid">
              <div className="bd-ad-tiercell">
                <span className="bd-ad-tierlabel">Creator</span>
                <span className="bd-ad-tiertitle">
                  @{row.creator.tiktokHandle.replace(/^@+/, '')}
                </span>
              </div>
              <div className="bd-ad-tiercell">
                <span className="bd-ad-tierlabel">Current tier</span>
                <span>
                  {row.creator.currentTier ? (
                    row.creator.currentTier.name
                  ) : (
                    <span className="bd-ad-muted">No tier</span>
                  )}
                </span>
              </div>
              <div className="bd-ad-tiercell">
                <span className="bd-ad-tierlabel">Followers</span>
                <span className="bd-mono">
                  {formatFollowerCount(row.creator.followerCount)}
                </span>
              </div>
              <div className="bd-ad-tiercell">
                <span className="bd-ad-tierlabel">Engagement</span>
                <span className="bd-mono">
                  {formatEngagementRate(row.creator.engagementRate)}
                </span>
              </div>
              <div className="bd-ad-tiercell bd-ad-tiercell--wide">
                <span className="bd-ad-tierlabel">Suggested</span>
                <span>{suggestedLabel(row.suggested)}</span>
              </div>
              <div className="bd-ad-tiercell">
                <span className="bd-ad-tierlabel">Flagged</span>
                <span>{formatDate(row.creator.tierReviewAt)}</span>
              </div>
              <RowActions row={row} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
