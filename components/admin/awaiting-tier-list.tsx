'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/feedback/empty-state';
import type { AwaitingTierCreator } from '@/lib/creators/awaiting-tier';
import {
  missingFieldLabel,
  missingTierFields,
} from '@/lib/creators/tier-rules';
import type { TierResponse } from '@/lib/creators/tier-assignment';

/**
 * Verified creators holding no tier (KAN-23, AC-5).
 *
 * The screen that keeps an un-tierable creator from disappearing. Each row
 * offers Retry assignment, which is what an admin presses after correcting the
 * creator's numbers or after a new band is seeded.
 */

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

/**
 * Why this creator is here, in the admin's terms.
 *
 * Derived from the row rather than carried over from the assignment attempt:
 * the numbers on screen are the current ones, and telling somebody "no tier
 * matched" about a creator whose follower count is blank would send them looking
 * for a band that does not exist instead of at the empty field in front of them.
 *
 * Asks `missingTierFields` rather than re-checking the columns, so the reason
 * shown here cannot disagree with the rule that actually refused to price them.
 * The check this replaced tested only for nulls, which meant a stored value the
 * rule rejects as unusable — an unparseable engagement rate — was reported as
 * "below every tier threshold", sending the admin to look at the bands instead of
 * at the field (KAN-24, F13).
 */
function blockedReason(creator: AwaitingTierCreator): string {
  const missing = missingTierFields(creator);
  if (missing.length === 0) return 'Below every tier threshold';
  return `Missing ${missing.map(missingFieldLabel).join(' and ')}`;
}

function RetryButton({ creator }: { creator: AwaitingTierCreator }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleRetry() {
    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/creators/${encodeURIComponent(creator.id)}/assign-tier`,
        { method: 'POST' }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(
        body?.error?.message ?? 'Something went wrong. Please try again.'
      );
      setSubmitting(false);
      return;
    }

    const payload = (await response.json().catch(() => null)) as {
      tier?: TierResponse;
    } | null;
    const tier = payload?.tier ?? null;

    if (tier?.assigned) {
      toast.success(`${creator.tiktokHandle} is now on the ${tier.name} tier`);
    } else {
      // Still stuck. The row stays on this list, so the state is not lost —
      // but saying so is what stops an admin pressing Retry in a loop.
      //
      // Branches on the reason the rule gave rather than restating one: telling
      // an admin to "update their follower count" about a creator whose numbers
      // are complete and simply below every band sends them to edit a field that
      // is already correct (same reasoning as `blockedReason`).
      toast.warning(
        tier?.reason === 'missing_data'
          ? `${creator.tiktokHandle} still matches no tier. Add their follower count and engagement rate first.`
          : `${creator.tiktokHandle} is still below every tier threshold.`
      );
    }

    // Reset before the refresh, not after: an assigned creator leaves this list
    // and the component unmounts, but an unassigned one stays, keyed by the same
    // id, so React reuses this instance — and a `submitting` left true would
    // disable the button until the page is reloaded by hand.
    setSubmitting(false);
    router.refresh();
  }

  return (
    <Button size="sm" onClick={handleRetry} disabled={submitting}>
      {submitting ? <Spinner className="size-3" /> : 'Retry assignment'}
    </Button>
  );
}

export function AwaitingTierList({
  creators,
}: {
  creators: AwaitingTierCreator[];
}) {
  if (creators.length === 0) {
    return (
      <EmptyState
        title="Every verified creator has a tier"
        description="Nobody is waiting on a price. Verified creators appear here only when no tier matches their audience."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              TikTok Handle
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Niche
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Followers
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Engagement
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Why
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Verified
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {creators.map((creator) => (
            <tr key={creator.id} className="hover:bg-muted/50">
              <td className="px-4 py-3">
                <span className="font-mono text-sm">
                  {creator.tiktokHandle}
                </span>
              </td>
              <td className="px-4 py-3 text-sm capitalize">{creator.niche}</td>
              <td className="px-4 py-3 text-sm">
                {formatFollowerCount(creator.followerCount)}
              </td>
              <td className="px-4 py-3 text-sm">
                {formatEngagementRate(creator.engagementRate)}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {blockedReason(creator)}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {formatDate(creator.verifiedAt)}
              </td>
              <td className="px-4 py-3">
                <RetryButton creator={creator} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
