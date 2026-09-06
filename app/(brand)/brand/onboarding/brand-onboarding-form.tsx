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
import { zodIssuesToDetails } from '@/lib/validation/errors';
import { fieldErrorsAt } from '@/lib/validation/field-errors';
import type { FieldErrorMap } from '@/lib/validation/field-errors';
import {
  MAX_COMPANY_NAME_LENGTH,
  createBrandSchema,
} from '@/lib/validation/schemas';

/**
 * Brand onboarding form (KAN-27 AC-1).
 *
 * Same shape as the creator form, for the same reasons: plain `useState` plus
 * `safeParse`, no form library, and error display driven by the server's
 * `details` map rather than by local assumptions. Client validation here is a
 * convenience and never the gate — `createBrandSchema` runs again in the route
 * handler, which is the only enforcement point (NFR-005). This form can be
 * bypassed with curl and nothing about that is a problem.
 */
export function BrandOnboardingForm() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);

  const companyNameErrors = fieldErrorsAt(errors, 'companyName');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    const parsed = createBrandSchema.safeParse({ companyName });
    if (!parsed.success) {
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      // `parsed.data`, not the raw state — so the trimmed name is what is sent
      // and what the brand then sees echoed back on their dashboard.
      response = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      // `refresh()` before `push()` so the layout re-runs its profile read on
      // the server; without it the router cache can serve the version that
      // redirected here in the first place.
      router.refresh();
      router.push('/brand');
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    if (error?.details) {
      setErrors(error.details as FieldErrorMap);
    }
    if (error?.message && !error?.details) {
      // PROFILE_EXISTS lands here: it is about the account, not about anything
      // typed in this box, so there is no input to attach it to.
      toast.error(error.message);
    }
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)] sm:p-8"
    >
      <div className="mb-7 border-b border-neutral-200 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
          Brand profile
        </p>
      </div>
      <FieldGroup className="gap-7">
        <Field data-invalid={companyNameErrors !== undefined || undefined}>
          <FieldLabel
            htmlFor="companyName"
            className="text-[13px] font-semibold text-neutral-700"
          >
            Brand or company name
          </FieldLabel>
          <Input
            id="companyName"
            name="companyName"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="h-12 bg-neutral-50 px-3.5 text-base transition-colors focus-visible:bg-white"
            placeholder="Habesha Coffee Roasters"
            maxLength={MAX_COMPANY_NAME_LENGTH}
            autoComplete="organization"
            autoFocus
            aria-invalid={companyNameErrors !== undefined || undefined}
          />
          <FieldDescription className="text-[13px] leading-relaxed text-neutral-500">
            This appears on your offers and campaign pages. Up to{' '}
            {MAX_COMPANY_NAME_LENGTH} characters.
          </FieldDescription>
          <FieldError errors={companyNameErrors} />
        </Field>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-7">
          <Button
            type="submit"
            disabled={submitting}
            size="lg"
            className="w-full sm:w-auto sm:self-start"
          >
            {submitting && <Spinner />}
            {submitting ? 'Creating profile…' : 'Create brand profile'}
          </Button>
          <p className="text-[13px] leading-relaxed text-neutral-500">
            Next, you can create a campaign and invite creators.
          </p>
        </div>
      </FieldGroup>
    </form>
  );
}
