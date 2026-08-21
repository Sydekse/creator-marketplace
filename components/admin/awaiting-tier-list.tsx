'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/feedback/empty-state';
import { ENGAGEMENT_RATE_HINT } from '@/lib/config/creator-profile';
import type { AwaitingTierCreator } from '@/lib/creators/awaiting-tier';
import {
  missingFieldLabel,
  missingTierFields,
} from '@/lib/creators/tier-rules';
import { updateCreatorNumbersSchema } from '@/lib/validation';
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

/**
 * Says what an assignment run did, shared by "Retry assignment" and "Save &
 * retry". Both press the same rule and both must say the same three things about
 * its result — success, still-missing-data, still-below-band — so the wording
 * lives in one place rather than being retyped per button and drifting apart.
 *
 * Branches on the reason the rule gave rather than restating one: telling an
 * admin to "add their numbers" about a creator whose numbers are complete and
 * simply below every band sends them to edit a field that is already correct
 * (the same reasoning as `blockedReason`).
 */
function announceTierOutcome(handle: string, tier: TierResponse | null): void {
  if (tier?.assigned) {
    toast.success(`${handle} is now on the ${tier.name} tier`);
    return;
  }
  // Still stuck. The row stays on this list, so the state is not lost — but
  // saying so is what stops an admin pressing Retry in a loop.
  toast.warning(
    tier?.reason === 'missing_data'
      ? `${handle} still matches no tier. Add their follower count and engagement rate first.`
      : `${handle} is still below every tier threshold.`
  );
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
    announceTierOutcome(creator.tiktokHandle, payload?.tier ?? null);

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

/** Blank input to the `undefined` the PATCH schema reads as "leave unchanged". */
function toOptionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

/**
 * The inline "fill in the numbers" form (KAN-24).
 *
 * The other half of the awaiting-tier fix: "Retry assignment" re-runs the rule,
 * but a creator who onboarded without a follower count has nothing for it to
 * read, so retry loops as a no-op. This edits the numbers and re-runs assignment
 * in the same request (`PATCH /api/admin/creators/:id`), so correcting the data
 * and pricing the creator happen together.
 *
 * Prefilled with the current values and validated with the same
 * `updateCreatorNumbersSchema` the route enforces — a convenience, never the
 * gate (the server parses again). An empty field means "leave unchanged", the
 * same rule the onboarding form applies to its optional numbers.
 */
function EditNumbersForm({
  creator,
  onDone,
}: {
  creator: AwaitingTierCreator;
  onDone: () => void;
}) {
  const router = useRouter();
  const [followerCount, setFollowerCount] = useState(
    creator.followerCount === null ? '' : String(creator.followerCount)
  );
  const [engagementRate, setEngagementRate] = useState(
    creator.engagementRate === null
      ? ''
      : String(parseFloat(creator.engagementRate))
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    const payload = {
      followerCount: toOptionalNumber(followerCount),
      engagementRate: toOptionalNumber(engagementRate),
    };

    // The same parser the route runs, so an out-of-range value or an empty form
    // is caught here with the schema's own message rather than a round-trip.
    const parsed = updateCreatorNumbersSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ??
          'Enter a follower count or an engagement rate.'
      );
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/creators/${encodeURIComponent(creator.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        }
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

    const body = (await response.json().catch(() => null)) as {
      tier?: TierResponse;
    } | null;
    announceTierOutcome(creator.tiktokHandle, body?.tier ?? null);

    // Close before refreshing: an assigned creator leaves this list and the row
    // unmounts, but one still below a band stays keyed by the same id, so React
    // reuses this instance — collapsing the form is what returns it to its
    // resting state instead of leaving the editor open over stale values.
    setSubmitting(false);
    onDone();
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
          Correct profile data
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-neutral-600">
          Update the figures used for tier matching, then run assignment again.
          Changes are saved to the creator profile.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
        <label className="flex flex-col gap-2 text-sm font-medium text-neutral-800">
          Followers
          <Input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={followerCount}
            onChange={(event) => setFollowerCount(event.target.value)}
            disabled={submitting}
            className="h-10 w-full bg-neutral-50 font-mono tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-neutral-800">
          Engagement rate
          <div className="relative">
            <Input
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              value={engagementRate}
              onChange={(event) => setEngagementRate(event.target.value)}
              disabled={submitting}
              className="h-10 w-full bg-neutral-50 pr-9 font-mono tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500">
              %
            </span>
          </div>
          {/* The admin correcting this figure needs the same definition the
            creator was given (KAN-200) — it feeds `matchTier`, so entering a
            different quantity here silently puts a creator in the wrong band. */}
          <span className="max-w-72 leading-normal font-normal text-balance">
            {ENGAGEMENT_RATE_HINT}
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Spinner className="size-3" /> : null}
          {submitting ? 'Saving and retrying' : 'Save and retry assignment'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * One creator's row, plus the edit form it can reveal beneath itself.
 *
 * The `editing` toggle lives here rather than on the list so opening one row's
 * editor does not re-render or disturb the others. The form renders in a second
 * `<tr>` spanning the table so the inputs have room the cramped Actions cell
 * does not.
 */
function CreatorRow({ creator }: { creator: AwaitingTierCreator }) {
  const [editing, setEditing] = useState(false);

  return (
    <Fragment>
      <tr className="transition-colors hover:bg-neutral-100/60">
        <td className="px-4 py-3">
          <span className="text-sm font-semibold text-neutral-900">
            @{creator.tiktokHandle.replace(/^@+/, '')}
          </span>
        </td>
        <td className="px-4 py-3 text-sm capitalize">{creator.niche}</td>
        <td className="px-4 py-3 font-mono text-xs tabular-nums">
          {formatFollowerCount(creator.followerCount)}
        </td>
        <td className="px-4 py-3 font-mono text-xs tabular-nums">
          {formatEngagementRate(creator.engagementRate)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {blockedReason(creator)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {formatDate(creator.verifiedAt)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {/* Below-threshold creators (complete numbers, no band) can still be
                retried after a new tier is seeded, so the plain retry stays. */}
            <RetryButton creator={creator} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing((open) => !open)}
            >
              {editing ? 'Close' : 'Edit numbers'}
            </Button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="bg-brand-tint/35">
          <td colSpan={7} className="px-4 py-4">
            <EditNumbersForm
              creator={creator}
              onDone={() => setEditing(false)}
            />
          </td>
        </tr>
      )}
    </Fragment>
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
        align="start"
        title="Every verified creator has a tier"
        description="Nobody is waiting on a price. Verified creators appear here only when no tier matches their audience."
      />
    );
  }

  return (
    <div className="overflow-x-auto border-b border-neutral-200">
      <table className="w-full">
        <thead className="bg-neutral-100/70">
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
        <tbody className="divide-y divide-neutral-200 bg-neutral-50">
          {creators.map((creator) => (
            <CreatorRow key={creator.id} creator={creator} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
