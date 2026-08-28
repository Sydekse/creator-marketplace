'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

/**
 * The creator's email and password, after Login Kit (phase 1).
 *
 * Only what is missing is asked for: a creator who already set a password
 * sees just the email field, and vice versa. Submitting nothing still hits
 * the server — `mapCredentialsError` is what turns a second attempt into a
 * "refresh and continue" rather than a stack trace.
 */
export function CreatorCredentialsForm({
  needsEmail,
  hasPassword,
}: {
  needsEmail: boolean;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = 'Enter a valid email address.';
    }
    if (!hasPassword) {
      if (password.length < 8) {
        next.password = 'Password must be at least 8 characters.';
      }
      if (password !== confirmPassword) {
        next.confirmPassword = 'Passwords do not match.';
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    const response = await fetch('/api/creators/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: needsEmail ? email : undefined,
        password: hasPassword ? undefined : password,
      }),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const details = body?.error?.details as Record<string, string[]> | null;
      const fieldErrors: FieldErrors = {};
      if (details?.email?.[0]) fieldErrors.email = details.email[0];
      if (details?.password?.[0]) fieldErrors.password = details.password[0];
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      } else {
        // No renderable field to pin it on — say what the server said, or the
        // first detail it sent, before falling back to the generic sentence.
        const firstDetail = details
          ? Object.values(details).flat()[0]
          : undefined;
        toast.error(
          body?.error?.message ??
            firstDetail ??
            'Could not save. Please try again.'
        );
      }
      setLoading(false);
      return;
    }

    toast.success('Saved.');
    router.refresh();
    router.push('/creator/onboarding');
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="surface-card flex flex-col gap-5 rounded-[24px] border border-neutral-200 p-6 shadow-[0_24px_60px_-32px_rgba(23,23,23,0.25)] sm:p-9"
    >
      {needsEmail ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="credentials-email"
            className="text-[13px] font-semibold text-neutral-700"
          >
            Email
          </label>
          <Input
            id="credentials-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
            }}
            placeholder="you@example.com"
            required
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={
              errors.email ? 'credentials-email-error' : undefined
            }
            className="h-11 px-3.5"
          />
          <FieldError id="credentials-email-error" message={errors.email} />
        </div>
      ) : null}

      {!hasPassword ? (
        <>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="credentials-password"
              className="text-[13px] font-semibold text-neutral-700"
            >
              Password
            </label>
            <PasswordInput
              id="credentials-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password)
                  setErrors((p) => ({ ...p, password: undefined }));
              }}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password ? 'credentials-password-error' : undefined
              }
              className="h-11 px-3.5"
            />
            <FieldError
              id="credentials-password-error"
              message={errors.password}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="credentials-confirm"
              className="text-[13px] font-semibold text-neutral-700"
            >
              Confirm password
            </label>
            <PasswordInput
              id="credentials-confirm"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword)
                  setErrors((p) => ({ ...p, confirmPassword: undefined }));
              }}
              placeholder="Re-enter your password"
              required
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={
                errors.confirmPassword ? 'credentials-confirm-error' : undefined
              }
              className="h-11 px-3.5"
            />
            <FieldError
              id="credentials-confirm-error"
              message={errors.confirmPassword}
            />
          </div>
        </>
      ) : null}

      <Button type="submit" disabled={loading} size="xl" className="w-full">
        {loading ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  );
}
