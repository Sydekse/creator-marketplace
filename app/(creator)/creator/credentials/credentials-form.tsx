'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TikTokIcon } from '@/components/brand/tiktok-icon';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { displayTiktokHandle } from '@/lib/creators/handle';
import { cn, textLinkFeedback } from '@/lib/utils';

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
 *
 * The form reveals itself stepwise (phase 3 cleanup): email → code → password.
 * Showing all three at once read as "fill everything, then wait for a code",
 * which is backwards. The reveal is presentation only — the POST still carries
 * email, code and password together, and the server still verifies the code
 * before writing anything, so the atomicity is unchanged.
 */
export function CreatorCredentialsForm({
  needsEmail,
  hasPassword,
  tiktokHandle = null,
}: {
  needsEmail: boolean;
  hasPassword: boolean;
  tiktokHandle?: string | null;
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
  const [codeReady, setCodeReady] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Presentation-only. The POST still sends email + code + password together;
  // the server still verifies the code. This only decides which card is showing.
  const view =
    needsEmail && !codeSent
      ? 'email'
      : needsEmail && !codeReady
        ? 'code'
        : !hasPassword
          ? 'password'
          : 'code';

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
      queueMicrotask(() => codeRef.current?.focus());
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
    queueMicrotask(() => codeRef.current?.focus());
  }

  function handleChangeEmail() {
    setCodeSent(false);
    setCode('');
    setCodeReady(false);
    setCooldown(0);
    setErrors((p) => ({ ...p, code: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (view === 'email') {
      await handleSendCode();
      return;
    }

    if (view === 'code') {
      if (!/^\d{6}$/.test(code)) {
        setErrors((p) => ({
          ...p,
          code: 'Enter the 6-digit code from the email.',
        }));
        return;
      }
      setLoading(true);
      let peek: Response;
      try {
        peek = await fetch('/api/creators/credentials/otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
      } catch {
        toast.error('Could not reach the server. Check your connection.');
        setLoading(false);
        return;
      }
      if (!peek.ok) {
        const peekBody = await peek.json().catch(() => null);
        const detail = peekBody?.error?.details?.code?.[0];
        setErrors((p) => ({
          ...p,
          code:
            detail ??
            'That code is not correct. Check the email and try again.',
        }));
        setLoading(false);
        return;
      }
      setLoading(false);
      if (!hasPassword) {
        setErrors((p) => ({ ...p, code: undefined }));
        setCodeReady(true);
        queueMicrotask(() => passwordRef.current?.focus());
        return;
      }
    }

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

  const copy =
    view === 'email'
      ? {
          eyebrow: 'Your email',
          title: 'Where can we reach you?',
          lede: 'TikTok does not share an email. Add one now so we can send offers and payout notices.',
        }
      : view === 'code'
        ? {
            eyebrow: '6-digit code',
            title: 'Check your inbox.',
            lede: `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
          }
        : {
            eyebrow: 'Sign in later',
            title: 'Set a password.',
            lede: 'Use this the next time you sign in, so you are not locked to TikTok.',
          };

  const primary =
    view === 'email'
      ? sendingCode
        ? 'Sending…'
        : 'Send code'
      : view === 'code'
        ? 'Continue'
        : loading
          ? 'Saving…'
          : 'Continue';

  const steps = needsEmail
    ? hasPassword
      ? (['Email', 'Code'] as const)
      : (['Email', 'Code', 'Password'] as const)
    : (['Password'] as const);
  const currentStep =
    view === 'email' ? 0 : view === 'code' ? 1 : steps.length - 1;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="surface-card auth-card flex w-full max-w-md flex-col rounded-[28px] border border-neutral-200 p-6 shadow-[0_24px_60px_-40px_rgba(23,23,23,0.35)] sm:p-8"
    >
      {steps.length > 1 ? (
        <ol className="flex" aria-label="Progress">
          {steps.map((label, i) => {
            const reached = i <= currentStep;
            const done = i < currentStep;
            return (
              <li
                key={label}
                className="flex min-w-0 flex-1 flex-col items-center gap-2"
                aria-current={i === currentStep ? 'step' : undefined}
              >
                <div className="flex w-full items-center">
                  <span
                    aria-hidden
                    className={
                      i === 0
                        ? 'h-0.5 flex-1 bg-transparent'
                        : done || i === currentStep
                          ? 'h-0.5 flex-1 bg-brand'
                          : 'h-0.5 flex-1 bg-neutral-200'
                    }
                  />
                  <span
                    aria-hidden
                    className={
                      i === currentStep
                        ? 'size-2 shrink-0 rounded-full bg-brand shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_18%,transparent)]'
                        : done
                          ? 'size-2 shrink-0 rounded-full bg-brand'
                          : 'size-2 shrink-0 rounded-full bg-neutral-200'
                    }
                  />
                  <span
                    aria-hidden
                    className={
                      i === steps.length - 1
                        ? 'h-0.5 flex-1 bg-transparent'
                        : done
                          ? 'h-0.5 flex-1 bg-brand'
                          : 'h-0.5 flex-1 bg-neutral-200'
                    }
                  />
                </div>
                <span
                  className={
                    i === currentStep
                      ? 'text-[11px] font-semibold tracking-[0.08em] text-brand-ink uppercase'
                      : reached
                        ? 'text-[11px] font-semibold tracking-[0.08em] text-neutral-800 uppercase'
                        : 'text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase'
                  }
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {view === 'email' && tiktokHandle ? (
        <p
          role="status"
          className={cn(
            'flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-tint px-4 py-3 text-[13px] leading-snug text-brand-ink',
            steps.length > 1 ? 'mt-5' : undefined
          )}
        >
          <TikTokIcon className="h-4 w-4 shrink-0" />
          <span>
            TikTok connected as{' '}
            <strong className="font-semibold">
              {displayTiktokHandle(tiktokHandle)}
            </strong>
          </span>
        </p>
      ) : null}
      <p className="mt-5 text-[13px] font-bold uppercase tracking-[0.14em] text-brand-ink">
        {copy.eyebrow}
      </p>
      <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-neutral-900">
        {copy.title}
      </h1>
      <p className="mt-3 max-w-[40ch] text-sm leading-relaxed text-neutral-600">
        {copy.lede}
      </p>
      <div className="mt-5 border-b border-neutral-200" aria-hidden="true" />

      <div className="mt-5 flex flex-col gap-4">
        {view === 'email' ? (
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
              className="h-10 px-3"
            />
            <FieldError id="credentials-email-error" message={errors.email} />
          </div>
        ) : null}

        {view === 'code' ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="credentials-code"
              className="text-[13px] font-semibold text-neutral-700"
            >
              Verification code
            </label>
            <Input
              ref={codeRef}
              id="credentials-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                if (errors.code) setErrors((p) => ({ ...p, code: undefined }));
              }}
              placeholder="6 digits"
              autoComplete="one-time-code"
              aria-invalid={!!errors.code}
              aria-describedby={
                errors.code ? 'credentials-code-error' : 'credentials-code-hint'
              }
              className="h-10 px-3 font-mono tracking-[0.2em]"
            />
            <p
              id="credentials-code-hint"
              className="text-[13px] leading-relaxed text-neutral-600"
            >
              We will check this code when you continue.
            </p>
            <FieldError id="credentials-code-error" message={errors.code} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleChangeEmail}
                className={cn(
                  'text-[13px] font-medium text-brand-ink hover:text-brand-strong',
                  textLinkFeedback
                )}
              >
                Change email
              </button>
              <p className="text-[13px] text-neutral-600" aria-live="polite">
                {sendingCode
                  ? 'Sending…'
                  : cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : null}
              </p>
              {cooldown === 0 && !sendingCode ? (
                <button
                  type="button"
                  onClick={handleSendCode}
                  className={cn(
                    'text-[13px] font-medium text-brand-ink hover:text-brand-strong',
                    textLinkFeedback
                  )}
                >
                  Resend code
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {view === 'password' ? (
          <>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="credentials-password"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Password
              </label>
              <PasswordInput
                ref={passwordRef}
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
                className="h-10 px-3"
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
                  errors.confirmPassword
                    ? 'credentials-confirm-error'
                    : undefined
                }
                className="h-10 px-3"
              />
              <FieldError
                id="credentials-confirm-error"
                message={errors.confirmPassword}
              />
            </div>
          </>
        ) : null}

        <Button
          type="submit"
          disabled={sendingCode || loading}
          size="xl"
          className="w-full bg-brand-deep text-neutral-50 hover:bg-brand-strong"
        >
          {primary}
        </Button>
      </div>
    </form>
  );
}
