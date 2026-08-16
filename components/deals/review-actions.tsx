'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  APPROVE_CONFIRM_MESSAGE,
  APPROVE_DELIVERABLE_LABEL,
  APPROVE_FAILED_MESSAGE,
  APPROVE_SUCCESS_MESSAGE,
  APPROVING_LABEL,
  REJECT_DELIVERABLE_LABEL,
  REJECT_FAILED_MESSAGE,
  REJECT_REASON_HINT,
  REJECT_REASON_LABEL,
  REJECT_REASON_PLACEHOLDER,
  REJECT_SUCCESS_MESSAGE,
  REJECTING_LABEL,
  REVIEW_NETWORK_ERROR_MESSAGE,
} from '@/lib/deals/copy';
import {
  fieldErrorsAt,
  rejectDeliverableSchema,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

/**
 * Approve or send back a delivered video (KAN-68, US-008, AC-023, AC-024).
 *
 * `'use client'` because it holds the rejection reason and two in-flight flags.
 * It is the smallest thing that has to be one — the page above renders it only
 * where `canReview(status)` is true and keeps everything else server-rendered.
 *
 * **Neither endpoint changes here.** `POST /approve` takes no body at all (the
 * amounts are derived under the ledger's lock, so there is nothing for a client
 * to vary except which deal, and that is in the path) and `POST /reject` takes
 * only `{ reason }`. Both re-check the role, the ownership and the status
 * server-side; these buttons are a courtesy, and disabling one stops an accident
 * rather than an attacker (NFR-005).
 *
 * **The reason is validated twice, on purpose.** `rejectDeliverableSchema` parses
 * here first and the endpoint answers 422 `REASON_REQUIRED` regardless — one copy
 * of the rule, rendered by whichever side caught the empty field first, through
 * the same `fieldErrorsAt` path every other form in this repo uses.
 */
export function ReviewActions({ dealId }: { dealId: string }) {
  const router = useRouter();

  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const reasonErrors = fieldErrorsAt(errors, 'reason');
  const busy = approving || rejecting;

  async function handleApprove() {
    // Re-entry guard, the shape `offer-actions.tsx` and `deliverable-form.tsx`
    // both use. `disabled` stops most double-clicks, but Enter and a click in the
    // same tick still fire twice — and the second request arrives as
    // `completed -> completed`, refused with a message about a deal that no
    // longer needs this control.
    if (busy) return;

    // Irreversible, and it moves money: the hold is released to the creator net
    // of commission and `LEGAL_TRANSITIONS.completed` is empty, so there is no
    // path back. `confirm` rather than a dialog because no dialog primitive is
    // installed and adding one for a yes/no would widen the ticket —
    // `remove-from-cart-button.tsx` set that precedent and `offer-actions.tsx`
    // followed it for decline.
    if (!window.confirm(APPROVE_CONFIRM_MESSAGE)) return;

    setApproving(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/deals/${encodeURIComponent(dealId)}/approve`,
        { method: 'POST' }
      );
    } catch {
      // Transport, not approval-specific — one sentence serves both buttons
      // rather than a near-duplicate free to drift.
      toast.error(REVIEW_NETWORK_ERROR_MESSAGE);
      setApproving(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      // The server's own sentence. Every code this endpoint returns has one in
      // `ErrorMessage` — including AC's `PAYMENT_FAILED` wording — and those
      // strings are acceptance criteria, so restating them here would create a
      // second copy free to drift.
      toast.error(body?.error?.message ?? APPROVE_FAILED_MESSAGE);
      setApproving(false);

      // Every failure here is a disagreement about state or a payment that did
      // not go through. Re-reading the server's view is what stops the screen
      // offering an action that cannot succeed.
      router.refresh();
      return;
    }

    toast.success(APPROVE_SUCCESS_MESSAGE);

    // Whether these controls render at all is server-rendered from
    // `deal.status`; the refresh is what replaces them with the completed view.
    setApproving(false);
    router.refresh();
  }

  async function handleReject(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setErrors({});

    const parsed = rejectDeliverableSchema.safeParse({ reason });
    if (!parsed.success) {
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setRejecting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/deals/${encodeURIComponent(dealId)}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The trimmed value parsing produced, so what the creator reads and what
          // the deliverable row stores are the same string.
          body: JSON.stringify(parsed.data),
        }
      );
    } catch {
      toast.error(REVIEW_NETWORK_ERROR_MESSAGE);
      setRejecting(false);
      return;
    }

    if (response.ok) {
      toast.success(REJECT_SUCCESS_MESSAGE);
      setReason('');
      setRejecting(false);
      router.refresh();
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    if (error?.details) {
      // The server's field errors (422 `REASON_REQUIRED`) — the same keys the
      // client-side parse produces, so both render through one path.
      setErrors(error.details as FieldErrorMap);
    } else {
      toast.error(error?.message ?? REJECT_FAILED_MESSAGE);
    }
    setRejecting(false);

    // A 409 is a state disagreement — approved in another tab, or already sent
    // back. Re-read rather than leave a control that cannot work.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleReject} noValidate>
        <FieldGroup className="gap-4">
          <Field data-invalid={reasonErrors !== undefined || undefined}>
            <FieldLabel htmlFor="reason">{REJECT_REASON_LABEL}</FieldLabel>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={REJECT_REASON_PLACEHOLDER}
              aria-invalid={reasonErrors !== undefined || undefined}
              aria-describedby={reasonErrors ? 'reason-error' : 'reason-hint'}
            />
            {reasonErrors ? (
              <FieldError id="reason-error" errors={reasonErrors} />
            ) : (
              <FieldDescription id="reason-hint">
                {REJECT_REASON_HINT}
              </FieldDescription>
            )}
          </Field>

          {fieldErrorsAt(errors, '_root') && (
            <FieldError errors={fieldErrorsAt(errors, '_root')} />
          )}

          <div className="flex flex-wrap items-center gap-3">
            {/* Approve is `type="button"`: it is not this form's submit, and
                leaving it as the default would make Enter in the reason field
                pay the creator. */}
            <Button type="button" onClick={handleApprove} disabled={busy}>
              {approving && <Spinner />}
              {approving ? APPROVING_LABEL : APPROVE_DELIVERABLE_LABEL}
            </Button>
            <Button type="submit" variant="outline" disabled={busy}>
              {rejecting && <Spinner />}
              {rejecting ? REJECTING_LABEL : REJECT_DELIVERABLE_LABEL}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
