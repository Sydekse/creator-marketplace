'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';

interface FieldErrors {
  email?: string;
  code?: string;
  password?: string;
  confirmPassword?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The creator's email and password, after Login Kit (phase 1; OTP in phase 3).
 *
 * Only what is missing is asked for: a creator who already set a password
 * sees just the email field, and vice versa. The email is verify-before-write:
 * "Send code" mails a 6-digit code to the typed address, and the save only
 * succeeds with that code — the server refuses an email without its proof, so
 * a typo can never become the address every offer notification rides on.
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
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  /** Seconds until another send is allowed; drives the resend countdown. */
  const [cooldown, setCooldown] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(
      () => setCooldown((s) => (s > 0 ? s - 1 : 0)),
      1000
    );
    return () => clearInterval(timer);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- one interval while counting, not one per tick

  async function handleSendCode() {
    if (!EMAIL_PATTERN.test(email)) {
      setErrors((p) => ({ ...p, email: 'Enter a valid email address.' }));
      return;
    }
    setErrors((p) => ({ ...p, email: undefined, code: undefined }));
    setSendingCode(true);

    let response: Response;
    try {
      response = await fetch('/api/creators/credentials/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSendingCode(false);
      return;
    }

    if (response.status === 429) {
      // A code already exists and is still fresh — count its cooldown down
      // rather than treating the earlier send as an error.
      const retryAfter = Number(response.headers.get('Retry-After')) || 60;
      setCodeSent(true);
      setCooldown(retryAfter);
      setSendingCode(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = body?.error?.details?.email?.[0];
      if (detail) {
        setErrors((p) => ({ ...p, email: detail }));
      } else {
        toast.error(
          body?.error?.message ?? 'Could not send the code. Please try again.'
        );
      }
      setSendingCode(false);
      return;
    }

    setCodeSent(true);
    setCooldown(60);
    setSendingCode(false);
    toast.success(`Code sent to ${email}.`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (needsEmail && !EMAIL_PATTERN.test(email)) {
      next.email = 'Enter a valid email address.';
    }
    if (needsEmail && !/^\d{6}$/.test(code)) {
      next.code = codeSent
        ? 'Enter the 6-digit code from the email.'
        : 'Send a code to your email first.';
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
        code: needsEmail ? code : undefined,
        password: hasPassword ? undefined : password,
      }),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const details = body?.error?.details as Record<string, string[]> | null;
      const fieldErrors: FieldErrors = {};
      if (details?.email?.[0]) fieldErrors.email = details.email[0];
      if (details?.code?.[0]) fieldErrors.code = details.code[0];
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
        <>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="credentials-email"
              className="text-[13px] font-semibold text-neutral-700"
            >
              Email
            </label>
            <div className="flex gap-2">
              <Input
                id="credentials-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email)
                    setErrors((p) => ({ ...p, email: undefined }));
                }}
                placeholder="you@example.com"
                required
                autoComplete="email"
                aria-invalid={!!errors.email}
                aria-describedby={
                  errors.email ? 'credentials-email-error' : undefined
                }
                className="h-11 px-4"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSendCode}
                disabled={sendingCode || cooldown > 0}
                className="h-11 shrink-0"
              >
                {sendingCode
                  ? 'Sending…'
                  : cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : codeSent
                      ? 'Resend code'
                      : 'Send code'}
              </Button>
            </div>
            <FieldError id="credentials-email-error" message={errors.email} />
          </div>
          {codeSent ? (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="credentials-code"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Verification code
              </label>
              <Input
                id="credentials-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                  if (errors.code)
                    setErrors((p) => ({ ...p, code: undefined }));
                }}
                placeholder="123456"
                autoComplete="one-time-code"
                aria-invalid={!!errors.code}
                aria-describedby={
                  errors.code ? 'credentials-code-error' : undefined
                }
                className="h-11 px-4 font-mono tracking-[0.3em]"
              />
              <p className="text-[13px] leading-relaxed text-neutral-600">
                Enter the 6-digit code we sent to your email. It expires in 10
                minutes.
              </p>
              <FieldError id="credentials-code-error" message={errors.code} />
            </div>
          ) : (
            <FieldError id="credentials-code-error" message={errors.code} />
          )}
        </>
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
              className="h-11 px-4"
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
              className="h-11 px-4"
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
