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
  APPROVE_DELIVERABLE_LABEL,
  APPROVE_FAILED_MESSAGE,
  APPROVE_SUCCESS_MESSAGE,
  APPROVING_LABEL,
  approveConfirmMessage,
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
 * Approve a delivered deal, or send one of its videos back (KAN-68, US-008,
 * AC-023, AC-024, F38).
 *
 * **Two components, because the two actions have different subjects.** Approval
 * is per **deal** — AC-023 releases "the held funds for that deal", one payout
 * against one hold, so there is exactly one Approve on the page no matter how many
 * videos it covers. Rejection is per **video**: with three on a deal, "request
 * changes" has to say which one, or the creator is left guessing which of three to
 * redo. So `RejectVideoForm` is rendered once per video and carries its
 * `deliverableId`; `ApproveDealButton` is rendered once.
 *
 * They were a single `ReviewActions` while a deal could only hold one video, where
 * the distinction did not exist yet. Kept in one file because they share this
 * surface's copy and its two failure paths, not because they are one control.
 *
 * `'use client'` because they hold the rejection reason and the in-flight flags.
 * These are the smallest things that have to be — the page above renders them only
 * where `canReview(status)` is true and keeps everything else server-rendered.
 *
 * **Neither endpoint trusts these.** `POST /approve` takes no body at all (the
 * amounts are derived under the ledger's lock, so there is nothing for a client to
 * vary except which deal, and that is in the path) and `POST /reject` re-checks
 * that the deliverable belongs to the deal. Both re-check the role, the ownership
 * and the status server-side; these controls are a courtesy, and disabling one
 * stops an accident rather than an attacker (NFR-005).
 *
 * **The reason is validated twice, on purpose.** `rejectDeliverableSchema` parses
 * here first and the endpoint answers 422 `REASON_REQUIRED` regardless — one copy
 * of the rule, rendered by whichever side caught the empty field first, through
 * the same `fieldErrorsAt` path every other form in this repo uses.
 */

/**
 * Approve every video on the deal and pay the creator (AC-023).
 *
 * Rendered once per deal. The page gates it on `canReview(status)`, which is
 * `{delivered}` — and a deal only reaches `delivered` once every video it was paid
 * for is in (F38), so this button cannot appear over a partial delivery.
 */
export function ApproveDealButton({
  dealId,
  videoCount,
}: {
  dealId: string;
  videoCount: number;
}) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);

  async function handleApprove() {
    // Re-entry guard, the shape `offer-actions.tsx` and `deliverable-form.tsx`
    // both use. `disabled` stops most double-clicks, but Enter and a click in the
    // same tick still fire twice — and the second request arrives as
    // `completed -> completed`, refused with a message about a deal that no
    // longer needs this control.
    if (approving) return;

    // Irreversible, and it moves money: the hold is released to the creator net
    // of commission and `LEGAL_TRANSITIONS.completed` is empty, so there is no
    // path back. `confirm` rather than a dialog because no dialog primitive is
    // installed and adding one for a yes/no would widen the ticket —
    // `remove-from-cart-button.tsx` set that precedent and `offer-actions.tsx`
    // followed it for decline.
    if (!window.confirm(approveConfirmMessage(videoCount))) return;

    setApproving(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/deals/${encodeURIComponent(dealId)}/approve`,
        { method: 'POST' }
      );
    } catch {
      // Transport, not approval-specific — one sentence serves both controls
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

    // Whether this control renders at all is server-rendered from `deal.status`;
    // the refresh is what replaces it with the completed view.
    setApproving(false);
    router.refresh();
  }

  return (
    <Button type="button" onClick={handleApprove} disabled={approving}>
      {approving && <Spinner />}
      {approving ? APPROVING_LABEL : APPROVE_DELIVERABLE_LABEL}
    </Button>
  );
}

/**
 * Send one video back to the creator with a reason (AC-024, F38).
 *
 * Rendered once per video, each with its own reason field and its own in-flight
 * flag — one shared field would make the brand's note ambiguous about which video
 * it described, which is the whole thing this ticket set out to fix at the data
 * level.
 *
 * `videoLabel` is the same "Video 2" the page renders as that video's heading, so
 * the field's accessible name says which video the reason is about rather than
 * repeating a generic label three times down the page.
 */
export function RejectVideoForm({
  dealId,
  deliverableId,
  videoLabel,
}: {
  dealId: string;
  deliverableId: string;
  videoLabel: string;
}) {
  const router = useRouter();

  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [rejecting, setRejecting] = useState(false);

  const reasonErrors = fieldErrorsAt(errors, 'reason');
  // Scoped to this video, so three forms on one page cannot collide on `id` or on
  // the `aria-describedby` they point at.
  const fieldId = `reason-${deliverableId}`;

  async function handleReject(event: React.FormEvent) {
    event.preventDefault();
    if (rejecting) return;

    setErrors({});

    const parsed = rejectDeliverableSchema.safeParse({
      deliverableId,
      reason,
    });
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
    <form onSubmit={handleReject} noValidate>
      <FieldGroup className="gap-4">
        <Field data-invalid={reasonErrors !== undefined || undefined}>
          <FieldLabel htmlFor={fieldId}>
            {REJECT_REASON_LABEL} <span className="sr-only">{videoLabel}</span>
          </FieldLabel>
          <Textarea
            id={fieldId}
            name="reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={REJECT_REASON_PLACEHOLDER}
            aria-invalid={reasonErrors !== undefined || undefined}
            aria-describedby={
              reasonErrors ? `${fieldId}-error` : `${fieldId}-hint`
            }
          />
          {reasonErrors ? (
            <FieldError id={`${fieldId}-error`} errors={reasonErrors} />
          ) : (
            <FieldDescription id={`${fieldId}-hint`}>
              {REJECT_REASON_HINT}
            </FieldDescription>
          )}
        </Field>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div>
          <Button type="submit" variant="outline" disabled={rejecting}>
            {rejecting && <Spinner />}
            {rejecting ? REJECTING_LABEL : REJECT_DELIVERABLE_LABEL}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
