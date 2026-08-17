'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * Admin flag-for-dispute toggle (KAN-81, AC-030; KAN-69 F40).
 *
 * The flag is attention metadata, not a status — `lib/deals/flag-deal.ts`
 * owns that distinction. This button is the missing *setter*: it POSTs to the
 * existing `/api/admin/deals/{id}/flag` endpoint (validation, admin gate, and
 * the audited write), then refreshes so the worklist row reflects the new
 * state. Flagging raises the attention state; the resolve form clears it in
 * the same transaction as the resolution, so the lifecycle needs no extra UI
 * here.
 *
 * The note is optional on the endpoint, and this is a direct toggle rather
 * than a dialog — the audit row still records the actor, the action, and the
 * new flag value, so no anonymous write happens.
 */
interface FlagDealButtonProps {
  dealId: string;
  campaignName: string;
  flagged: boolean;
}

export function FlagDealButton({
  dealId,
  campaignName,
  flagged,
}: FlagDealButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleToggle() {
    if (submitting) return;

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/deals/${encodeURIComponent(dealId)}/flag`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagged: !flagged }),
        }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      toast.success(
        flagged
          ? `${campaignName} flag cleared.`
          : `${campaignName} flagged for dispute — it stays on the worklist until resolved.`
      );
      router.refresh();
    } else {
      let message = 'Flag update failed. Please try again.';
      try {
        const body = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON failure body — keep the generic message.
      }
      toast.error(message);
    }

    setSubmitting(false);
  }

  return (
    <Button
      type="button"
      variant={flagged ? 'secondary' : 'outline'}
      size="sm"
      disabled={submitting}
      onClick={handleToggle}
    >
      {submitting ? <Spinner /> : null}
      {flagged ? 'Clear flag' : 'Flag for dispute'}
    </Button>
  );
}
