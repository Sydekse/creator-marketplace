'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <Card className="w-full max-w-sm p-8">
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Sign In</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Welcome back to Creator Marketplace
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
            placeholder="Enter your password"
            required
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link
          href="/sign-up"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Sign up
        </Link>
      </p>
    </Card>
  );
}
