'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  FUND_CAMPAIGN_FAILED,
  FUND_CHECKOUT_LABEL,
  FUND_CHECKOUT_PENDING_LABEL,
  FUND_NO_ACCEPTED_DEALS_MESSAGE,
  FUND_NOT_FUNDABLE_MESSAGE,
  FUND_TEST_MODE_HINT,
} from '@/lib/campaigns/constants';

export interface FundCheckoutButtonProps {
  campaignId: string;
  /** Deals currently `accepted`. Zero disables the button, like the mock one. */
  acceptedCount: number;
  /** ETB total the checkout will quote, preformatted server-side. */
  formattedTotal: string;
  /** True on a test key — renders the no-real-money hint (demo-critical). */
  testMode: boolean;
  size?: 'sm' | 'lg';
}

/**
 * KAN-70 — the Chapa-mode sibling of `FundCampaignButton`.
 *
 * Same skeleton and the same honesty about being cosmetic (the session route
 * re-checks status, ownership and the accepted set), but the success path is
 * a departure, not a refresh: POST opens a `funding_session` and the browser
 * leaves for Chapa's hosted checkout. Money is confirmed later, by the
 * webhook or the return page — never by this component.
 */
export function FundCheckoutButton({
  campaignId,
  acceptedCount,
  formattedTotal,
  testMode,
  size = 'sm',
}: FundCheckoutButtonProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const nothingAccepted = acceptedCount === 0;

  async function handleCheckout() {
    if (leaving || nothingAccepted) return;
    setLeaving(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/fund/session`,
        { method: 'POST' }
      );
    } catch {
      toast.error('Could not reach the server. Reload and try again.');
      setLeaving(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body?.error?.code;

      if (code === 'CAMPAIGN_NOT_FUNDABLE') {
        toast.warning(FUND_NOT_FUNDABLE_MESSAGE);
        setLeaving(false);
        router.refresh();
        return;
      }
      if (code === 'NO_ACCEPTED_DEALS') {
        toast.warning(FUND_NO_ACCEPTED_DEALS_MESSAGE);
        setLeaving(false);
        router.refresh();
        return;
      }
      // PAYMENT_FAILED (Chapa unreachable) and anything else: the server's
      // own sentence, with our generic fallback.
      toast.error(body?.error?.message ?? FUND_CAMPAIGN_FAILED);
      setLeaving(false);
      return;
    }

    const body = await response.json().catch(() => null);
    const checkoutUrl: unknown = body?.checkout_url;
    if (typeof checkoutUrl !== 'string' || checkoutUrl.length === 0) {
      toast.error(FUND_CAMPAIGN_FAILED);
      setLeaving(false);
      return;
    }

    // `assign`, not `router.push`: the checkout is another origin entirely,
    // and the browser's back button should return to this campaign page.
    // `leaving` stays true — the button has done its job.
    window.location.assign(checkoutUrl);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={leaving || nothingAccepted}
        className={cn(
          buttonVariants({ size }),
          'w-full border-0 bg-brand text-neutral-50 shadow-[0_0_0_1px_rgba(250,250,250,0.12)] hover:bg-brand-soft hover:text-neutral-50 active:bg-brand-deep',
          nothingAccepted
            ? 'opacity-50'
            : 'ring-2 ring-brand-tint/80 ring-offset-2 ring-offset-neutral-900'
        )}
      >
        {leaving ? FUND_CHECKOUT_PENDING_LABEL : FUND_CHECKOUT_LABEL}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={FUND_CHECKOUT_LABEL}
        description={`You'll be taken to Chapa's secure checkout to pay ${formattedTotal}. The money is held in escrow until each creator delivers.`}
        confirmLabel={FUND_CHECKOUT_LABEL}
        onConfirm={handleCheckout}
      />
      {testMode && !nothingAccepted && (
        <p className="text-xs leading-relaxed text-neutral-400">
          {FUND_TEST_MODE_HINT}
        </p>
      )}
      {nothingAccepted && (
        <p className="text-sm text-neutral-400">
          {FUND_NO_ACCEPTED_DEALS_MESSAGE}
        </p>
      )}
    </div>
  );
}
