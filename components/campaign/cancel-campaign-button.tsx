'use client';

import { useState, useTransition } from 'react';
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
  /**
   * Where the button is rendered. On the campaign **detail** page (`detail`,
   * the default) a successful cancel pushes to `/campaigns` — the campaign it
   * sat on no longer has anything to show. On the campaigns **list** (`list`)
   * the brand is already standing where a success would send them, so the row
   * refreshes in place and its chip reads `cancelled`.
   */
  context?: 'detail' | 'list';
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
  context = 'detail',
}: CancelCampaignButtonProps) {
  const router = useRouter();
  const [cancelling, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleCancel() {
    if (cancelling) return;

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/cancel`,
          { method: 'POST' }
        );
      } catch {
        toast.error('Could not reach the server. Check your connection.');
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
          router.refresh();
          return;
        }

        toast.error(CANCEL_CAMPAIGN_FAILED);
        return;
      }

      toast.success(CANCEL_CAMPAIGN_SUCCESS);

      // From the detail page this navigates to the list, which re-reads the
      // status on arrival. From the list itself there is nowhere to go — the row
      // is already here — so success refreshes and the chip reads `cancelled`.
      if (context === 'list') {
        router.refresh();
        return;
      }
      router.push('/campaigns');
    });
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
