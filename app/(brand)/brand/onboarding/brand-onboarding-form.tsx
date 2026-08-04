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
  createBrandSchema,
  fieldErrorsAt,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

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
            placeholder="Habesha Coffee Roasters"
            maxLength={MAX_COMPANY_NAME_LENGTH}
            autoComplete="organization"
            autoFocus
            aria-invalid={companyNameErrors !== undefined || undefined}
          />
          <FieldDescription>
            Shown to creators on every offer. Up to {MAX_COMPANY_NAME_LENGTH}{' '}
            characters.
          </FieldDescription>
          <FieldError errors={companyNameErrors} />
        </Field>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-8">
          <Button
            type="submit"
            disabled={submitting}
            size="lg"
            className="w-full sm:w-auto sm:self-start"
          >
            {submitting && <Spinner />}
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Next you will brief a campaign and pick creators within its budget.
          </p>
        </div>
      </FieldGroup>
    </form>
  );
}
