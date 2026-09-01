'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  FUNDING_CANCEL_FAILED,
  FUNDING_CANCEL_LABEL,
  FUNDING_PENDING_BODY,
  FUNDING_PENDING_TITLE,
  FUNDING_RESUME_LABEL,
} from '@/lib/campaigns/constants';

export interface PendingPaymentBannerProps {
  campaignId: string;
  /** The open session's hosted-checkout URL — resuming is just going back. */
  checkoutUrl: string;
}

/**
 * KAN-70 — what a brand sees between "left for Chapa checkout" and "money
 * confirmed" (or gave up). Replaces the fund button while a session is open,
 * so there is exactly one way to pay at any moment.
 *
 * Cancel is a UI dismissal, not a revocation — the server comment on
 * `cancelFundingSession` owns that story; if the checkout gets paid anyway,
 * settlement still honours it.
 */
export function PendingPaymentBanner({
  campaignId,
  checkoutUrl,
}: PendingPaymentBannerProps) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/fund/session`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        toast.error(FUNDING_CANCEL_FAILED);
        setCancelling(false);
        return;
      }
    } catch {
      toast.error(FUNDING_CANCEL_FAILED);
      setCancelling(false);
      return;
    }
    // The banner and the fund button both render server-side from the open
    // session — refresh swaps this banner back for the button.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-amber-200">
          {FUNDING_PENDING_TITLE}
        </p>
        <p className="text-xs leading-relaxed text-neutral-300">
          {FUNDING_PENDING_BODY}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={checkoutUrl}
          className={cn(
            buttonVariants({ size: 'sm' }),
            'border-0 bg-brand text-neutral-50 hover:bg-brand-soft hover:text-neutral-50'
          )}
        >
          {FUNDING_RESUME_LABEL}
        </a>
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'border-neutral-600 bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100'
          )}
        >
          {cancelling ? 'Cancelling…' : FUNDING_CANCEL_LABEL}
        </button>
      </div>
    </div>
  );
}
