'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { ContinueWithTiktok } from '@/components/auth/continue-with-tiktok';
import { RoleNotch } from '@/components/auth/role-notch';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { FieldError } from '@/components/ui/field-error';
import { toast } from 'sonner';
import { signUpSchema } from '@/lib/validation/schemas';
import { cn, textLinkFeedback } from '@/lib/utils';
import type { SelfRegisterableRole } from '@/lib/auth-policy';

type RoleOption = SelfRegisterableRole;

function AccordionPanel({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      )}
    >
      <div
        className={cn(
          'min-h-0 overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-0'
        )}
        inert={!open}
        aria-hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
};

export function SignUpCard({
  creatorDemoSignup,
  oauthError = null,
}: {
  /**
   * Whether the email/password creator path (demo accounts) is offered.
   * Read from `CREATOR_DEMO_SIGNUP` by the server page; the API enforces
   * the same flag in the sign-up hook, so this only controls visibility.
   */
  creatorDemoSignup: boolean;
  /**
   * TikTok OAuth came back failed. Open on creator so the button (and the
   * alert) are not hidden behind the brand default.
   */
  oauthError?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<RoleOption>(
    oauthError ? 'creator' : 'brand'
  );
  const [creatorDemo, setCreatorDemo] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = signUpSchema.safeParse({ name, email, password, role });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        name: fieldErrors.name?.[0],
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
        role: fieldErrors.role?.[0],
      });
      return;
    }
    if (password !== confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match.' });
      return;
    }
    setErrors({});
    setLoading(true);

    // `role` is an additional field, which Better Auth's generated client types
    // do not narrow, so the call is widened to accept it.
    const { error } = await (
      authClient.signUp as unknown as {
        email: (data: {
          name: string;
          email: string;
          password: string;
          role: RoleOption;
        }) => Promise<{ error?: { message?: string } }>;
      }
    ).email({
      name,
      email,
      password,
      role: parsed.data.role,
    });

    if (error) {
      setFormError(
        error.message ?? 'Failed to create account. Please try again.'
      );
      setLoading(false);
      return;
    }

    toast.success('Account created. Welcome.');
    // /dashboard resolves the role server-side, so the client never has to.
    // Stay pending until the destination layout has built the real nav.
    router.push('/dashboard');
  }

  return (
    <div className="surface-card auth-card relative w-full max-w-md rounded-[28px] border border-neutral-200 px-7 pb-6 pt-12 shadow-[0_24px_60px_-40px_rgba(23,23,23,0.35)] sm:px-9 sm:pb-8 sm:pt-13">
      <RoleNotch
        value={role}
        onChange={(next) => {
          setRole(next);
          setFormError(null);
          if (errors.role) setErrors((p) => ({ ...p, role: undefined }));
        }}
      />

      <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-ink">
        Create account
      </p>
      <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
        Join the marketplace.
      </h1>
      <p className="mt-3 max-w-[40ch] text-sm leading-relaxed text-neutral-600">
        {role === 'creator'
          ? 'Creators continue with TikTok. We only ask for a public profile.'
          : 'Brands create a free profile with email and password.'}
      </p>

      <div className="mt-5 border-b border-neutral-200" aria-hidden="true" />

      {/* One credential form, two placements: brands always, creators only
          when the demo flag has revealed it. The same `handleSubmit` runs
          either way — the only difference is which accordion it sits in. */}
      <AccordionPanel
        open={role === 'brand' || (role === 'creator' && creatorDemo)}
      >
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <label
              htmlFor="name"
              className="text-[13px] font-semibold text-neutral-700"
            >
              Name
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              placeholder="Your full name"
              required
              autoComplete="name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
              className="h-10 px-3"
            />
            <FieldError id="name-error" message={errors.name} />
          </div>

          <div className="flex flex-col gap-2">
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
                if (errors.email)
                  setErrors((p) => ({ ...p, email: undefined }));
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

          <div className="flex flex-col gap-2">
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
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              className="h-10 px-3"
            />
            <FieldError id="password-error" message={errors.password} />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="confirmPassword"
              className="text-[13px] font-semibold text-neutral-700"
            >
              Confirm password
            </label>
            <PasswordInput
              id="confirmPassword"
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
                errors.confirmPassword ? 'confirm-password-error' : undefined
              }
              className="h-10 px-3"
            />
            <FieldError
              id="confirm-password-error"
              message={errors.confirmPassword}
            />
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] leading-snug text-destructive"
            >
              {formError}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            size="xl"
            className="w-full bg-brand-deep text-neutral-50 hover:bg-brand-strong"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </AccordionPanel>

      <AccordionPanel open={role === 'creator' && !creatorDemo}>
        <div className="mt-6 flex flex-col gap-4">
          <ContinueWithTiktok
            errorCallbackURL="/sign-up"
            oauthError={oauthError}
          />
          {creatorDemoSignup && (
            <button
              type="button"
              onClick={() => setCreatorDemo(true)}
              className={cn(
                'self-center text-[13px] font-medium text-neutral-500 hover:text-neutral-800',
                textLinkFeedback
              )}
            >
              Sign up with email and password
            </button>
          )}
        </div>
      </AccordionPanel>

      <div className="mt-7 border-t border-neutral-200" aria-hidden="true" />

      <p className="mt-5 text-center text-[13px] text-neutral-600">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className={cn(
            'font-medium text-brand-ink hover:text-brand-strong',
            textLinkFeedback
          )}
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
