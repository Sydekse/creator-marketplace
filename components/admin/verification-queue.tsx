'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/feedback/empty-state';
import type { QueueCreator } from '@/lib/creators/verification-queue';
import type { TierResponse } from '@/lib/creators/tier-assignment';

/**
 * Admin verification queue table (KAN-22).
 *
 * Each row: creator profile details + Approve/Reject actions. Reject reveals
 * an optional note textarea. On action, POST to the verify endpoint, then
 * refresh the server component.
 *
 * KAN-23: an approval also reports what tier the creator landed on, or that
 * they landed on none.
 */

/**
 * What the admin is told after an approval (KAN-23, AC-5).
 *
 * The unmatched cases are deliberately not `toast.success` — approving somebody
 * who is still not bookable is a half-finished outcome, and a green tick reads
 * as "done". `/admin/tiers` is named in the message because that is where the
 * work that is left actually lives.
 */
function approvalMessage(handle: string, tier: TierResponse): string {
  if (tier?.assigned) return `Approved ${handle} — ${tier.name} tier`;
  if (tier?.reason === 'missing_data') {
    return `Approved ${handle} — no follower or engagement data, so no tier was assigned. Not bookable yet; see Awaiting tier.`;
  }
  return `Approved ${handle} — no tier matched their audience, so none was assigned. Not bookable yet; see Awaiting tier.`;
}

function formatFollowerCount(count: number | null): string {
  if (count === null) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function formatEngagementRate(rate: string | null): string {
  if (rate === null) return '—';
  return `${parseFloat(rate).toFixed(1)}%`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

interface RowActionsProps {
  creator: QueueCreator;
  onSuccess: () => void;
}

function RowActions({ creator, onSuccess }: RowActionsProps) {
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleDecision(decision: 'verified' | 'rejected') {
    setSubmitting(true);

    const body = {
      decision,
      ...(decision === 'rejected' && rejectNote ? { note: rejectNote } : {}),
    };

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/creators/${encodeURIComponent(creator.id)}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      if (decision === 'rejected') {
        toast.success(`Rejected ${creator.tiktokHandle}`);
      } else {
        // A body that will not parse must not lose the approval: it succeeded,
        // and the tier is reportable from `/admin/tiers` either way.
        const payload = (await response.json().catch(() => null)) as {
          tier?: TierResponse;
        } | null;
        const tier = payload?.tier ?? null;
        const message = approvalMessage(creator.tiktokHandle, tier);
        if (tier?.assigned) {
          toast.success(message);
        } else {
          toast.warning(message);
        }
      }
      setShowRejectNote(false);
      setRejectNote('');
      onSuccess();
    } else {
      const body = await response.json().catch(() => null);
      const message =
        body?.error?.message ?? 'Something went wrong. Please try again.';
      toast.error(message);
      setSubmitting(false);
    }
  }

  if (showRejectNote) {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          placeholder="Optional note (will be included in rejection email)"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          className="min-h-20"
          disabled={submitting}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleDecision('rejected')}
            disabled={submitting}
          >
            {submitting ? <Spinner className="size-3" /> : 'Confirm reject'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowRejectNote(false);
              setRejectNote('');
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        onClick={() => handleDecision('verified')}
        disabled={submitting}
      >
        {submitting ? <Spinner className="size-3" /> : 'Approve'}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => setShowRejectNote(true)}
        disabled={submitting}
      >
        Reject
      </Button>
    </div>
  );
}

export function VerificationQueue({ creators }: { creators: QueueCreator[] }) {
  const router = useRouter();

  if (creators.length === 0) {
    return (
      <EmptyState
        title="No pending creators"
        description="All submitted creator profiles have been reviewed."
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
              Submitted
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
                {formatDate(creator.createdAt)}
              </td>
              <td className="px-4 py-3">
                <RowActions
                  creator={creator}
                  onSuccess={() => router.refresh()}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
