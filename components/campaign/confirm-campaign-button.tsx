'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { deliveryTerm } from '@/lib/deals/deadline';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  deliveryWindowDays?: number | null;
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
  deliveryWindowDays,
}: ConfirmCampaignButtonProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const empty = itemCount === 0;

  async function handleConfirm() {
    if (sending || empty || deliveryWindowDays == null) return;

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
        body?.error?.details?.excess?.[0] ??
        body?.error?.details?.deliveryWindowDays?.[0] ??
        body?.error?.details?._root?.[0];

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
        onClick={() => setConfirmOpen(true)}
        disabled={sending || empty || deliveryWindowDays == null}
        className={buttonVariants({ size: 'sm' })}
      >
        {sending ? CONFIRM_CAMPAIGN_PENDING_LABEL : CONFIRM_CAMPAIGN_LABEL}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={CONFIRM_CAMPAIGN_LABEL}
        description={`${CONFIRM_CAMPAIGN_PROMPT} Delivery agreement: ${deliveryTerm(deliveryWindowDays)}. This term is fixed on the offers; each day is 24 hours.`}
        confirmLabel={CONFIRM_CAMPAIGN_LABEL}
        onConfirm={handleConfirm}
      />
      {/* Why it is disabled, in a sentence beside the control. A `title=`
          tooltip would tell a touch user nothing. */}
      {deliveryWindowDays == null && (
        <p className="text-sm text-muted-foreground">
          <Link className="underline" href={`/campaigns/${campaignId}/edit`}>
            Edit the draft
          </Link>{' '}
          to choose a delivery window before sending offers.
        </p>
      )}
      {empty && (
        <p className="text-muted-foreground text-sm">
          {CONFIRM_EMPTY_CART_MESSAGE}
        </p>
      )}
    </div>
  );
}
