'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ENGAGEMENT_RATE_HINT } from '@/lib/config/creator-profile';
import type { AwaitingTierCreator } from '@/lib/creators/awaiting-tier';
import {
  missingFieldLabel,
  missingTierFields,
} from '@/lib/creators/tier-rules';
import { updateCreatorNumbersSchema } from '@/lib/validation/schemas';
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
  const [submitting, startTransition] = useTransition();

  function handleRetry() {
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(
          `/api/admin/creators/${encodeURIComponent(creator.id)}/assign-tier`,
          { method: 'POST' }
        );
      } catch {
        toast.error('Could not reach the server. Check your connection.');
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(
          body?.error?.message ?? 'Something went wrong. Please try again.'
        );
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        tier?: TierResponse;
      } | null;
      announceTierOutcome(creator.tiktokHandle, payload?.tier ?? null);

      // An assigned creator leaves this list and the component unmounts, but an
      // unassigned one stays, keyed by the same id, so React reuses this
      // instance — the transition's pending flag clears itself once the refresh
      // settles, re-enabling the button.
      router.refresh();
    });
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
  const [submitting, startTransition] = useTransition();

  function handleSave() {
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

    startTransition(async () => {
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
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(
          body?.error?.message ?? 'Something went wrong. Please try again.'
        );
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
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      className="bd-ad-inlineform"
    >
      <div className="bd-ad-inlineform-head">
        <p className="bd-eyebrow">Correct profile data</p>
        <p>
          Update the figures used for tier matching, then run assignment again.
          Changes are saved to the creator profile.
        </p>
      </div>
      <div className="bd-ad-inlineform-grid">
        <label className="bd-ad-field">
          Followers
          <Input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={followerCount}
            onChange={(event) => setFollowerCount(event.target.value)}
            disabled={submitting}
            className="bd-mono"
          />
        </label>
        <label className="bd-ad-field">
          Engagement rate
          <div className="bd-ad-percentfield">
            <Input
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              value={engagementRate}
              onChange={(event) => setEngagementRate(event.target.value)}
              disabled={submitting}
              className="bd-mono"
            />
            <span>%</span>
          </div>
          {/* The admin correcting this figure needs the same definition the
            creator was given (KAN-200) — it feeds `matchTier`, so entering a
            different quantity here silently puts a creator in the wrong band. */}
          <span className="bd-ad-fieldnote">{ENGAGEMENT_RATE_HINT}</span>
        </label>
      </div>
      <div className="bd-ad-inlineform-actions">
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
 * panel beneath the ledger row so the inputs have room the compact actions
 * cell does not.
 */
function CreatorRow({ creator }: { creator: AwaitingTierCreator }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="bd-ad-tierrow bd-ad-workrow--wait">
      <div className="bd-ad-tierrow-grid">
        <div className="bd-ad-tiercell">
          <span className="bd-ad-tierlabel">Creator</span>
          <span className="bd-ad-tiertitle">
            @{creator.tiktokHandle.replace(/^@+/, '')}
          </span>
        </div>
        <div className="bd-ad-tiercell">
          <span className="bd-ad-tierlabel">Niche</span>
          <span className="capitalize">{creator.niche}</span>
        </div>
        <div className="bd-ad-tiercell">
          <span className="bd-ad-tierlabel">Followers</span>
          <span className="bd-mono">
            {formatFollowerCount(creator.followerCount)}
          </span>
        </div>
        <div className="bd-ad-tiercell">
          <span className="bd-ad-tierlabel">Engagement</span>
          <span className="bd-mono">
            {formatEngagementRate(creator.engagementRate)}
          </span>
        </div>
        <div className="bd-ad-tiercell bd-ad-tiercell--wide">
          <span className="bd-ad-tierlabel">Why</span>
          <span>{blockedReason(creator)}</span>
        </div>
        <div className="bd-ad-tiercell">
          <span className="bd-ad-tierlabel">Verified</span>
          <span>{formatDate(creator.verifiedAt)}</span>
        </div>
        <div className="bd-ad-tieractions">
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
      </div>
      {editing && (
        <div className="bd-ad-tieredit">
          <EditNumbersForm creator={creator} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}

export function AwaitingTierList({
  creators,
}: {
  creators: AwaitingTierCreator[];
}) {
  if (creators.length === 0) {
    return (
      <div className="bd-emptyfeed">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.5 7h13" />
          <path d="M7 7v10h10V7" />
          <path d="M9 11.5l2 2 4-4" />
        </svg>
        <h3>Every verified creator has a tier</h3>
        <p>
          Nobody is waiting on a price. Verified creators appear here only when
          no tier matches their audience.
        </p>
      </div>
    );
  }

  return (
    <div className="bd-ad-ledgerframe bd-ad-tierframe">
      <div className="bd-ad-tiercols" aria-hidden="true">
        <span>Creator</span>
        <span>Niche</span>
        <span>Followers</span>
        <span>Engagement</span>
        <span>Why</span>
        <span>Verified</span>
        <span>Actions</span>
      </div>
      <ul className="bd-ad-ledgerlist">
        {creators.map((creator) => (
          <CreatorRow key={creator.id} creator={creator} />
        ))}
      </ul>
    </div>
  );
}
