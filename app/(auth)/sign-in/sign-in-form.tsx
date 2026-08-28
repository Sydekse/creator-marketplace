'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { ContinueWithTiktok } from '@/components/auth/continue-with-tiktok';
import { SectionLabel } from '@/components/layout/section-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { FieldError } from '@/components/ui/field-error';
import { signInSchema } from '@/lib/validation/schemas';
import { safeRedirectPath } from '@/lib/navigation';
import { cn, textLinkFeedback } from '@/lib/utils';

type FieldErrors = { email?: string; password?: string };

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      });
      return;
    }
    setErrors({});
    setLoading(true);

    const { error } = await authClient.signIn.email({ email, password });

    if (error) {
      // A credential failure is not a field problem — it could be either the
      // email or the password, so it belongs above the button, not under one.
      setFormError(error.message ?? 'Failed to sign in. Please try again.');
      setLoading(false);
      return;
    }

    // Honour wherever the proxy bounced the user from, otherwise let
    // /dashboard resolve the role server-side. The client never maps roles to
    // paths — it does not know the role until the server tells it.
    const requested = safeRedirectPath(searchParams.get('redirect'));
    // Stay on this form (button still pending) until the destination layout
    // has built the real nav. Do not refresh here — that unmounts auth early.
    router.push(requested ?? '/dashboard');
  }

  return (
    <div className="surface-card auth-card w-full max-w-md rounded-[28px] border border-neutral-200 p-6 shadow-[0_24px_60px_-40px_rgba(23,23,23,0.35)] sm:p-8">
      <SectionLabel as="p">Welcome back</SectionLabel>
      <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
        Sign in.
      </h1>
      <p className="mt-2.5 max-w-[40ch] text-sm leading-relaxed text-neutral-600">
        Your deals, escrow, and messages are here when you need them.
      </p>

      <div className="mt-5 border-b border-neutral-200" aria-hidden="true" />

      <div className="mt-5 flex flex-col gap-4">
        {/* Not wired for sign-in during sandbox testing: the button stays
            visible, disabled, so a returning creator knows the path exists. */}
        <ContinueWithTiktok disabledNote="On testing phase, use email and password." />
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-neutral-200" />
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
            or email
          </span>
          <span className="h-px flex-1 bg-neutral-200" />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-4 flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-[13px] font-semibold text-neutral-700"
          >
            Email
          </label>
          <Input
            id="email"
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
            aria-describedby={errors.email ? 'email-error' : undefined}
            className="h-10 px-3"
          />
          <FieldError id="email-error" message={errors.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-[13px] font-semibold text-neutral-700"
          >
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password)
                setErrors((p) => ({ ...p, password: undefined }));
            }}
            placeholder="Enter your password"
            required
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            className="h-10 px-3"
          />
          <FieldError id="password-error" message={errors.password} />
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
          >
            {formError}
          </div>
        )}

        <Button
          type="submit"
          disabled={loading}
          size="xl"
          className="w-full bg-brand text-neutral-50 hover:bg-brand-deep"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-neutral-500">
        New to Creator Marketplace?{' '}
        <Link
          href="/sign-up"
          className={cn(
            'font-medium text-brand hover:text-brand-deep',
            textLinkFeedback
          )}
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
