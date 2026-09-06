'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  FUND_CAMPAIGN_FAILED,
  FUND_CAMPAIGN_LABEL,
  FUND_CAMPAIGN_PENDING_LABEL,
  FUND_CAMPAIGN_PROMPT,
  FUND_CAMPAIGN_SUCCESS,
  FUND_NO_ACCEPTED_DEALS_MESSAGE,
  FUND_NOT_FUNDABLE_MESSAGE,
} from '@/lib/campaigns/constants';

export interface FundCampaignButtonProps {
  campaignId: string;
  /**
   * Deals currently `accepted`. Zero disables the button, because there is
   * nothing to hold — the endpoint answers the same case with a 409.
   */
  acceptedCount: number;
  /**
   * `lg` where the button is the page's primary money action (the budget
   * summary card), `sm` where it sits in a row of secondary controls.
   */
  size?: 'sm' | 'lg';
}

/**
 * KAN-43 / AC-019 — hold the accepted total for a confirmed campaign.
 *
 * The page renders this only while the campaign is `confirmed`, and the button
 * disables itself with no accepted deals. Both are conveniences: the endpoint
 * re-checks the status, the ownership and the accepted set inside the same
 * transaction that moves the money, because a hidden or disabled control is
 * cosmetic (NFR-005).
 */
export function FundCampaignButton({
  campaignId,
  acceptedCount,
  size = 'sm',
}: FundCampaignButtonProps) {
  const router = useRouter();
  const [funding, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const nothingAccepted = acceptedCount === 0;

  function handleFund() {
    if (funding || nothingAccepted) return;

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/fund`,
          { method: 'POST' }
        );
      } catch {
        // No response, so no envelope and no code to branch on. A network failure
        // says nothing about whether the hold was placed, which is why the copy
        // sends the brand to reload rather than telling them to try again.
        toast.error('Could not reach the server. Reload to see the campaign.');
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.error?.code;

        if (code === 'CAMPAIGN_NOT_FUNDABLE') {
          // Already funded, in another tab or by a double submit, or not confirmed
          // yet. Either way this view is the stale one — refresh and let the status
          // badge say which.
          toast.warning(FUND_NOT_FUNDABLE_MESSAGE);
          router.refresh();
          return;
        }

        if (code === 'NO_ACCEPTED_DEALS') {
          // Someone accepted or declined since this page rendered. Refreshing is
          // what re-enables or re-disables the button correctly.
          toast.warning(FUND_NO_ACCEPTED_DEALS_MESSAGE);
          router.refresh();
          return;
        }

        // `PAYMENT_FAILED` lands here and shows the server's own sentence — "Payment
        // failed — please try again." is an acceptance criterion's wording, and
        // paraphrasing it here would create a second copy free to drift.
        toast.error(body?.error?.message ?? FUND_CAMPAIGN_FAILED);
        return;
      }

      toast.success(FUND_CAMPAIGN_SUCCESS);

      // The status badge, the held-in-escrow row and this button's own disappearance
      // all render on the server from `campaign.status` and the ledger. Refreshing
      // re-reads both rather than patching a client copy that can disagree.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={funding || nothingAccepted}
        className={cn(
          buttonVariants({ size }),
          'w-full border-0 bg-brand text-neutral-50 shadow-[0_0_0_1px_rgba(250,250,250,0.12)] hover:bg-brand-soft hover:text-neutral-50 active:bg-brand-deep',
          nothingAccepted
            ? 'opacity-50'
            : 'ring-2 ring-brand-tint/80 ring-offset-2 ring-offset-neutral-900'
        )}
      >
        {funding ? FUND_CAMPAIGN_PENDING_LABEL : FUND_CAMPAIGN_LABEL}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={FUND_CAMPAIGN_LABEL}
        description={FUND_CAMPAIGN_PROMPT}
        confirmLabel={FUND_CAMPAIGN_LABEL}
        onConfirm={handleFund}
      />
      {/* Why it is disabled, in a sentence beside the control. A `title=`
          tooltip would tell a touch user nothing. */}
      {nothingAccepted && (
        <p className="text-sm text-neutral-400">
          {FUND_NO_ACCEPTED_DEALS_MESSAGE}
        </p>
      )}
    </div>
  );
}
