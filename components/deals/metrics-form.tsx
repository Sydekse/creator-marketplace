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
  METRICS_DESCRIPTION,
  METRICS_HINT,
  METRICS_TITLE,
  METRIC_COMMENTS_LABEL,
  METRIC_LIKES_LABEL,
  METRIC_SHARES_LABEL,
  METRIC_VIEWS_LABEL,
  SUBMIT_METRICS_FAILED_MESSAGE,
  SUBMIT_METRICS_LABEL,
  SUBMIT_METRICS_NETWORK_ERROR_MESSAGE,
  SUBMIT_METRICS_SUCCESS_MESSAGE,
  SUBMITTING_METRICS_LABEL,
} from '@/lib/deals/copy';
import {
  fieldErrorsAt,
  updateMetricsSchema,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

/**
 * The creator records engagement metrics for a delivered video (KAN-48,
 * AC-028; the KAN-57 review's F2 fix).
 *
 * KAN-48 built `PUT /api/deliverables/{id}/metrics` and no UI ever called it —
 * the reminder email's "Submit your metrics" had nowhere to land. This form is
 * that place: rendered by the completed-deal page, it posts the four counts
 * through the same endpoint the reminder chases.
 *
 * `'use client'` because it holds form state — the smallest thing that has to
 * be one, the `DeliverableForm` shape.
 *
 * **The empty field is `undefined`, never `0`.** The KAN-50 distinction this
 * whole feature rests on is null ≠ zero: a recorded `0` is a measurement and
 * clears "Metrics pending", while a missing field keeps it. `Number('')` is
 * `0`, so empty strings are converted to `undefined` *before* the shared
 * schema sees them — the same conversion rule `updateMetricsSchema` encodes
 * (every field optional, at least one present).
 *
 * **The validation runs twice, and that is the point.** The endpoint refuses
 * anything that is not a whole non-negative count with 422 `VALIDATION_ERROR`
 * and field-level details, so this form parses the same schema first and shows
 * the same field error the server would send — one copy of the rule, rendered
 * by whichever side caught the bad number first. The server stays the
 * authority either way (NFR-005). The one pre-check that is not in the schema
 * is the string→number conversion itself: `Number('twelve')` is `NaN`, which
 * zod would report as a confusing "expected integer, received nan", so a
 * non-numeric field is refused here with a sentence instead.
 *
 * The copy comes from `lib/deals/copy.ts`, not `lib/deals/detail.ts` — the
 * same bundle-boundary rule as `DeliverableForm`; see that module's header.
 */
const METRIC_FIELDS = [
  { key: 'views', label: METRIC_VIEWS_LABEL },
  { key: 'likes', label: METRIC_LIKES_LABEL },
  { key: 'shares', label: METRIC_SHARES_LABEL },
  { key: 'comments', label: METRIC_COMMENTS_LABEL },
] as const;

type MetricKey = (typeof METRIC_FIELDS)[number]['key'];

export function MetricsForm({ deliverableId }: { deliverableId: string }) {
  const router = useRouter();

  const [values, setValues] = useState<Record<MetricKey, string>>({
    views: '',
    likes: '',
    shares: '',
    comments: '',
  });
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Re-entry guard, the `DeliverableForm` shape.
    if (submitting) return;

    setErrors({});

    // Empty → `undefined` (not submitted), never `0` (a measurement).
    const converted: Partial<Record<MetricKey, number>> = {};
    for (const field of METRIC_FIELDS) {
      const trimmed = values[field.key].trim();
      if (trimmed === '') continue;

      const number = Number(trimmed);
      if (Number.isNaN(number)) {
        setErrors({ [field.key]: ['Enter a whole number.'] });
        return;
      }
      converted[field.key] = number;
    }

    const parsed = updateMetricsSchema.safeParse(converted);
    if (!parsed.success) {
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/deliverables/${encodeURIComponent(deliverableId)}/metrics`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          // The converted values the parse produced, so the fields and the row
          // agree about what was and was not submitted.
          body: JSON.stringify(parsed.data),
        }
      );
    } catch {
      // Transport, not submission-specific — the same sentence the deliverable
      // form uses for the same failure, so the two cannot drift.
      toast.error(SUBMIT_METRICS_NETWORK_ERROR_MESSAGE);
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      toast.success(SUBMIT_METRICS_SUCCESS_MESSAGE);

      // The row is updated, and the brand's dashboard reads it on its next
      // render. The form stays — AC-028's update path lets the creator correct
      // or extend the numbers later — so there is nothing to swap off-screen;
      // the refresh re-reads the deal and clears the request state below.
      setValues({ views: '', likes: '', shares: '', comments: '' });
      setSubmitting(false);
      router.refresh();
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    if (error?.details) {
      // The server's field errors (422 VALIDATION_ERROR) — same keys the
      // client-side parse produces, so the two render through one path.
      setErrors(error.details as FieldErrorMap);
    } else {
      toast.error(error?.message ?? SUBMIT_METRICS_FAILED_MESSAGE);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{METRICS_TITLE}</h2>
        <p className="text-sm text-muted-foreground">{METRICS_DESCRIPTION}</p>
      </div>

      <FieldGroup className="gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {METRIC_FIELDS.map((field) => {
            const fieldErrors = fieldErrorsAt(errors, field.key);
            return (
              <Field
                key={field.key}
                data-invalid={fieldErrors !== undefined || undefined}
              >
                <FieldLabel htmlFor={`metric-${field.key}`}>
                  {field.label}
                </FieldLabel>
                <Input
                  id={`metric-${field.key}`}
                  name={field.key}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={values[field.key]}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }))
                  }
                  placeholder="0"
                  aria-invalid={fieldErrors !== undefined || undefined}
                  aria-describedby={
                    fieldErrors ? `metric-${field.key}-error` : 'metrics-hint'
                  }
                />
                {fieldErrors ? (
                  <FieldError
                    id={`metric-${field.key}-error`}
                    errors={fieldErrors}
                  />
                ) : null}
              </Field>
            );
          })}
        </div>

        <FieldDescription id="metrics-hint">{METRICS_HINT}</FieldDescription>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div>
          <Button type="submit" disabled={submitting} size="sm">
            {submitting && <Spinner />}
            {submitting ? SUBMITTING_METRICS_LABEL : SUBMIT_METRICS_LABEL}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
