'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import {
  CAMPAIGN_NOT_DRAFT_MESSAGE,
  CONFIRM_CAMPAIGN_FAILED,
  CONFIRM_CAMPAIGN_LABEL,
  CONFIRM_CAMPAIGN_PENDING_LABEL,
  CONFIRM_CAMPAIGN_PROMPT,
  CONFIRM_CAMPAIGN_SUCCESS,
  CONFIRM_EMPTY_CART_MESSAGE,
} from '@/lib/campaigns/constants';

export interface ConfirmCampaignButtonProps {
  campaignId: string;
  /** Cart size, for the empty-cart state. Zero disables the button. */
  itemCount: number;
}

/**
 * KAN-33 / AC-016 — confirm a draft campaign and send an offer to every creator
 * in its cart.
 *
 * The page renders this only while the campaign is `draft`, and the button
 * disables itself on an empty cart. Both are conveniences: the endpoint
 * re-checks status, ownership, cart contents and the budget ceiling on every
 * call, because a hidden or disabled control is cosmetic (NFR-005, AC-014).
 */
export function ConfirmCampaignButton({
  campaignId,
  itemCount,
}: ConfirmCampaignButtonProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const empty = itemCount === 0;

  async function handleConfirm() {
    if (sending || empty) return;

    // Irreversible in both directions the brand cares about — creators are
    // notified immediately, and the brief locks. `confirm` rather than a dialog
    // for the same reason the remove button uses it: no dialog primitive is
    // installed, and adding one for a single yes/no would widen this ticket.
    if (!window.confirm(CONFIRM_CAMPAIGN_PROMPT)) {
      return;
    }

    setSending(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/confirm`,
        { method: 'POST' }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSending(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body?.error?.code;

      if (code === 'CAMPAIGN_NOT_DRAFT') {
        // Already confirmed, in another tab or by a double submit. Refresh —
        // this view is the stale one, and the offers did go out.
        toast.warning(CAMPAIGN_NOT_DRAFT_MESSAGE);
        setSending(false);
        router.refresh();
        return;
      }

      // The server's own sentence, when it sent one. `BUDGET_EXCEEDED` carries
      // the exact shortfall and `VALIDATION_ERROR` the empty-cart sentence;
      // paraphrasing either here would drop the number that makes it useful.
      const detail =
        body?.error?.details?.excess?.[0] ?? body?.error?.details?._root?.[0];

      toast.error(detail ?? CONFIRM_CAMPAIGN_FAILED);
      setSending(false);
      return;
    }

    toast.success(CONFIRM_CAMPAIGN_SUCCESS);

    // The status badge, the locked brief and the vanished remove buttons all
    // render on the server from `campaign.status`. Refreshing re-reads that
    // rather than patching a client copy that can disagree with it.
    setSending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleConfirm}
        disabled={sending || empty}
        className={buttonVariants({ size: 'sm' })}
      >
        {sending ? CONFIRM_CAMPAIGN_PENDING_LABEL : CONFIRM_CAMPAIGN_LABEL}
      </button>
      {/* Why it is disabled, in a sentence beside the control. A `title=`
          tooltip would tell a touch user nothing. */}
      {empty && (
        <p className="text-muted-foreground text-sm">
          {CONFIRM_EMPTY_CART_MESSAGE}
        </p>
      )}
    </div>
  );
}
