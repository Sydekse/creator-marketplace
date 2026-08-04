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
  MAX_COMPANY_NAME_LENGTH,
  fieldErrorsAt,
  updateBrandSchema,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

/**
 * Rename a brand profile (KAN-27 AC-5).
 *
 * The id is a prop rather than something this component looks up, and it is not
 * a secret: knowing it grants nothing, because `PATCH /api/brands/{id}` runs
 * the ownership check server-side against `brand_profile.user_id` (invariant 2).
 * Editing it in devtools yields a 403, not someone else's row.
 */
export function BrandSettingsForm({
  brandProfileId,
  companyName: initialCompanyName,
}: {
  brandProfileId: string;
  companyName: string;
}) {
  const router = useRouter();

  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);

  const companyNameErrors = fieldErrorsAt(errors, 'companyName');
  // Compared trimmed, so adding trailing spaces is not an edit — the server
  // would store the same string and the success toast would be a lie.
  const unchanged = companyName.trim() === initialCompanyName;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    const parsed = updateBrandSchema.safeParse({ companyName });
    if (!parsed.success) {
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/brands/${encodeURIComponent(brandProfileId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      const body = await response.json().catch(() => null);
      // The stored value wins over what is in the box, so the field shows what
      // creators will actually see rather than the untrimmed draft.
      if (typeof body?.company_name === 'string') {
        setCompanyName(body.company_name);
      }
      toast.success('Company name updated.');
      // Re-runs the server read behind this page and anything else showing the
      // name, so the header and dashboard do not keep the old one.
      router.refresh();
      setSubmitting(false);
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    if (error?.details) {
      setErrors(error.details as FieldErrorMap);
    }
    if (error?.message && !error?.details) {
      toast.error(error.message);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup className="gap-8">
        <Field data-invalid={companyNameErrors !== undefined || undefined}>
          <FieldLabel htmlFor="companyName">Company name</FieldLabel>
          <Input
            id="companyName"
            name="companyName"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="h-11 text-base"
            maxLength={MAX_COMPANY_NAME_LENGTH}
            autoComplete="organization"
            aria-invalid={companyNameErrors !== undefined || undefined}
          />
          <FieldDescription>
            Up to {MAX_COMPANY_NAME_LENGTH} characters.
          </FieldDescription>
          <FieldError errors={companyNameErrors} />
        </Field>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div className="flex border-t border-border pt-8">
          <Button type="submit" disabled={submitting || unchanged} size="lg">
            {submitting && <Spinner />}
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
