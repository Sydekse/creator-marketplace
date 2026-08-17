'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { signInSchema } from '@/lib/validation/schemas';
import { safeRedirectPath } from '@/lib/navigation';

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input.');
      return;
    }
    setLoading(true);

    const { error } = await authClient.signIn.email({ email, password });

    if (error) {
      toast.error(error.message ?? 'Failed to sign in.');
      setLoading(false);
      return;
    }

    // Honour wherever the proxy bounced the user from, otherwise let
    // /dashboard resolve the role server-side. The client never maps roles to
    // paths — it does not know the role until the server tells it.
    const requested = safeRedirectPath(searchParams.get('redirect'));
    router.push(requested ?? '/dashboard');
    router.refresh();
  }

  return (
    <div className="w-full max-w-md rounded-[24px] border border-neutral-200 bg-white p-8 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)] sm:p-10">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
        Welcome back
      </p>
      <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
        Sign in.
      </h1>
      <p className="mt-2.5 max-w-[40ch] text-sm leading-relaxed text-neutral-600">
        Your deals, escrow, and messages are all here — pick up where you left
        off.
      </p>

      <div className="mt-6 border-b border-neutral-200" aria-hidden="true" />

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-[13px] font-medium text-neutral-700"
          >
            Email
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-[13px] font-medium text-neutral-700"
          >
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" disabled={loading} size="xl" className="w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-neutral-500">
        New to Creator Marketplace?{' '}
        <Link
          href="/sign-up"
          className="font-medium text-brand underline-offset-4 hover:text-brand-deep"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
