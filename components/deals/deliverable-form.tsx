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
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  SUBMIT_DELIVERABLE_FAILED_MESSAGE,
  SUBMIT_DELIVERABLE_LABEL,
  SUBMIT_DELIVERABLE_NETWORK_ERROR_MESSAGE,
  SUBMIT_DELIVERABLE_SUCCESS_MESSAGE,
  SUBMIT_DELIVERABLE_URL_HINT,
  SUBMIT_DELIVERABLE_URL_LABEL,
  SUBMIT_DELIVERABLE_URL_PLACEHOLDER,
  SUBMITTING_DELIVERABLE_LABEL,
} from '@/lib/deals/copy';
import {
  fieldErrorsAt,
  submitDeliverableSchema,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

/**
 * Submit the live TikTok post URL for a funded deal (KAN-46, AC-022, AC-025).
 *
 * `'use client'` because it holds form state. It is the smallest thing that
 * has to be one — the page above renders it only where `canDeliver(status)` is
 * true, and keeps everything else server-rendered.
 *
 * **The validation runs twice, and that is the point.** The endpoint refuses
 * anything that is not an allowlisted TikTok video URL with 422
 * `INVALID_TIKTOK_URL` (AC-025), so this form parses the same schema first and
 * shows the same field error the server would send — one copy of the rule,
 * rendered by whichever side caught the bad link first. The server is the
 * authority either way (NFR-005): clearing the client-side check in devtools
 * changes nothing about what gets stored.
 *
 * **The URL is sent to the server and stored; nothing here fetches it**
 * (AC-8, Tech Spec §6.3). The input is plain text — no preview, no embed, no
 * link unfurling — so a malicious link cannot make the browser talk to an
 * arbitrary host on the creator's behalf either.
 *
 * The copy comes from `lib/deals/copy.ts`, not `lib/deals/detail.ts` — the
 * same bundle-boundary rule as `offer-actions.tsx`; see that module's header.
 */
export function DeliverableForm({ dealId }: { dealId: string }) {
  const router = useRouter();

  const [tiktokUrl, setTiktokUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);

  const urlErrors = fieldErrorsAt(errors, 'tiktokUrl');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Re-entry guard, the same shape `offer-actions.tsx` uses for accept and
    // decline. `disabled={submitting}` stops most double-clicks, but Enter +
    // click in the same tick can still fire twice — and the second request
    // would arrive as `delivered → delivered`, refused by the state machine
    // with a message about a deal that no longer needs this form.
    if (submitting) return;

    setErrors({});

    const parsed = submitDeliverableSchema.safeParse({ tiktokUrl });
    if (!parsed.success) {
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/deals/${encodeURIComponent(dealId)}/deliverable`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The trimmed value parsing produced, so the field and the row agree.
          body: JSON.stringify(parsed.data),
        }
      );
    } catch {
      // Transport, not submission-specific — the same sentence the accept
      // surface uses for the same failure, so the two cannot drift.
      toast.error(SUBMIT_DELIVERABLE_NETWORK_ERROR_MESSAGE);
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      toast.success(SUBMIT_DELIVERABLE_SUCCESS_MESSAGE);

      // The deal is `delivered` now, and whether this form renders at all is
      // server-rendered from `deal.status` — the refresh is what swaps the
      // form for the submitted-video section.
      setTiktokUrl('');
      setSubmitting(false);
      router.refresh();
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    if (error?.details) {
      // The server's field errors (422 INVALID_TIKTOK_URL) — same keys the
      // client-side parse produces, so the two render through one path.
      setErrors(error.details as FieldErrorMap);
    } else {
      // The server's own sentence. Every code this endpoint returns has one in
      // `ErrorMessage`, and AC-025's is the exact wording the ticket demands;
      // `SUBMIT_DELIVERABLE_FAILED_MESSAGE` covers a response shaped unlike
      // the envelope.
      toast.error(error?.message ?? SUBMIT_DELIVERABLE_FAILED_MESSAGE);
    }
    setSubmitting(false);

    // A 409 here is a disagreement about state — the deal was funded in
    // another tab, or already delivered. Re-reading the server's view is what
    // makes the screen stop offering an action that cannot succeed.
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup className="gap-4">
        <Field data-invalid={urlErrors !== undefined || undefined}>
          <FieldLabel htmlFor="tiktokUrl">
            {SUBMIT_DELIVERABLE_URL_LABEL}
          </FieldLabel>
          <Input
            id="tiktokUrl"
            name="tiktokUrl"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={tiktokUrl}
            onChange={(event) => setTiktokUrl(event.target.value)}
            placeholder={SUBMIT_DELIVERABLE_URL_PLACEHOLDER}
            aria-invalid={urlErrors !== undefined || undefined}
            aria-describedby={urlErrors ? 'tiktokUrl-error' : 'tiktokUrl-hint'}
          />
          {urlErrors ? (
            <FieldError id="tiktokUrl-error" errors={urlErrors} />
          ) : (
            <FieldDescription id="tiktokUrl-hint">
              {SUBMIT_DELIVERABLE_URL_HINT}
            </FieldDescription>
          )}
        </Field>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div>
          <Button type="submit" disabled={submitting} size="sm">
            {submitting && <Spinner />}
            {submitting
              ? SUBMITTING_DELIVERABLE_LABEL
              : SUBMIT_DELIVERABLE_LABEL}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
