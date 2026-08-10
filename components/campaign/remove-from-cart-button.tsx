'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import {
  CAMPAIGN_NOT_DRAFT_MESSAGE,
  REMOVE_FROM_CART_FAILED,
  REMOVE_FROM_CART_LABEL,
  REMOVE_FROM_CART_MISSING,
  REMOVE_FROM_CART_PENDING_LABEL,
  REMOVE_FROM_CART_SUCCESS,
} from '@/lib/campaigns/constants';

export interface RemoveFromCartButtonProps {
  campaignId: string;
  creatorId: string;
  /** For the confirm prompt and the toast — the brand picked a person, not a row. */
  creatorHandle: string;
}

/**
 * KAN-32 / AC-015 — remove a creator from a draft campaign cart.
 *
 * The page renders this only while the campaign is `draft`. That is a
 * convenience, not the rule: the endpoint re-checks the status and the
 * ownership on every call, because a hidden button is cosmetic (NFR-005).
 */
export function RemoveFromCartButton({
  campaignId,
  creatorId,
  creatorHandle,
}: RemoveFromCartButtonProps) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    if (removing) return;

    // Destructive and one click away. `confirm` rather than a dialog because
    // the repo has no dialog primitive installed, and adding one for a single
    // yes/no would widen this ticket.
    if (!window.confirm(`Remove ${creatorHandle} from this campaign's cart?`)) {
      return;
    }

    setRemoving(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/items/${encodeURIComponent(creatorId)}`,
        { method: 'DELETE' }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setRemoving(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body?.error?.code;
      if (code === 'NOT_FOUND') {
        // Already gone. Refresh anyway — this view is the stale one.
        toast.warning(REMOVE_FROM_CART_MISSING);
        setRemoving(false);
        router.refresh();
        return;
      }
      toast.error(
        code === 'CAMPAIGN_NOT_DRAFT'
          ? CAMPAIGN_NOT_DRAFT_MESSAGE
          : REMOVE_FROM_CART_FAILED
      );
      setRemoving(false);
      return;
    }

    toast.success(REMOVE_FROM_CART_SUCCESS);

    // AC-015's "the running total and remaining budget update accordingly".
    // The response carries both, but the summary is rendered on the server
    // from `sumCartTotal`, so refreshing re-reads the source of truth rather
    // than patching two numbers into the DOM from a client copy that can
    // disagree with it.
    setRemoving(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={removing}
      aria-label={`${REMOVE_FROM_CART_LABEL} ${creatorHandle}`}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {removing ? REMOVE_FROM_CART_PENDING_LABEL : REMOVE_FROM_CART_LABEL}
    </button>
  );
}
