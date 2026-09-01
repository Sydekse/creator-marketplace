'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * Admin retry for a failed external (Chapa) refund (KAN-70 PR 4).
 *
 * The books are already right — the internal escrow refund committed when
 * the dispute resolved — so this button only re-asks the gateway to move the
 * external money. It POSTs `/api/admin/refunds/{id}/retry` and refreshes;
 * the row's status chip flipping to `processing` is the confirmation. A 409
 * (`REFUND_ALREADY_SETTLED`) means someone else's retry won — refreshing
 * shows the truth, so it is surfaced as information, not failure styling.
 */
interface RetryRefundButtonProps {
  refundId: string;
  campaignName: string;
}

export function RetryRefundButton({
  refundId,
  campaignName,
}: RetryRefundButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleRetry() {
    if (submitting) return;

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/refunds/${encodeURIComponent(refundId)}/retry`,
        { method: 'POST' }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      toast.success(`Refund for ${campaignName} re-submitted to Chapa.`);
      router.refresh();
    } else {
      let message = 'Refund retry failed. Please try again.';
      try {
        const body = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON failure body — keep the generic message.
      }
      toast.error(message);
      router.refresh();
    }

    setSubmitting(false);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={submitting}
      onClick={handleRetry}
    >
      {submitting ? <Spinner /> : null}
      Retry refund
    </Button>
  );
}
