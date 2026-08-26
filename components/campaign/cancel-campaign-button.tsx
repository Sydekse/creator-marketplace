'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  CANCEL_CAMPAIGN_FAILED,
  CANCEL_CAMPAIGN_LABEL,
  CANCEL_CAMPAIGN_PENDING_LABEL,
  CANCEL_CAMPAIGN_SUCCESS,
  CANCEL_NOT_CANCELLABLE_MESSAGE,
  cancelCampaignPrompt,
} from '@/lib/campaigns/constants';

export interface CancelCampaignButtonProps {
  campaignId: string;
  /** For the confirm prompt — the brand named this campaign, so name it back. */
  campaignName: string;
}

/**
 * KAN-200 — cancel a draft campaign.
 *
 * `POST /api/campaigns/{id}/cancel` has existed since KAN-99 with no caller. The
 * page renders this only while the campaign is `draft`; the endpoint accepts
 * `confirmed` too, but shipping the button for a confirmed campaign would cancel
 * offers creators are already holding with no notification telling them so.
 *
 * Hiding it is the courtesy either way. The endpoint re-checks the role, the
 * ownership and the status on every call, because a button that is not on screen
 * is not a rule (NFR-005).
 */
export function CancelCampaignButton({
  campaignId,
  campaignName,
}: CancelCampaignButtonProps) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleCancel() {
    if (cancelling) return;

    setCancelling(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/cancel`,
        { method: 'POST' }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setCancelling(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body?.error?.code;

      // `NOT_FOUND` is also what the route answers for a campaign on another
      // brand, so it cannot be reported as "already cancelled" — that would make
      // the id an existence oracle from the client side, the rule
      // `readCreatorDetail` set. Both refusals reload instead, and the status chip
      // says where the campaign actually stands.
      if (code === 'NOT_FOUND' || code === 'VALIDATION_ERROR') {
        toast.warning(CANCEL_NOT_CANCELLABLE_MESSAGE);
        setCancelling(false);
        router.refresh();
        return;
      }

      toast.error(CANCEL_CAMPAIGN_FAILED);
      setCancelling(false);
      return;
    }

    toast.success(CANCEL_CAMPAIGN_SUCCESS);

    // `push`, not `refresh`: the page this button sits on is the campaign that no
    // longer has anything to do. The list is where the brand goes next, and it
    // re-reads the status from the server on arrival.
    router.push('/campaigns');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={cancelling}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {cancelling ? CANCEL_CAMPAIGN_PENDING_LABEL : CANCEL_CAMPAIGN_LABEL}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={CANCEL_CAMPAIGN_LABEL}
        description={cancelCampaignPrompt(campaignName)}
        confirmLabel={CANCEL_CAMPAIGN_LABEL}
        tone="destructive"
        onConfirm={handleCancel}
      />
    </>
  );
}
