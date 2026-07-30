'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { signUpSchema } from '@/lib/validation/schemas';
import type { SelfRegisterableRole } from '@/lib/auth-policy';

type RoleOption = SelfRegisterableRole;

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<RoleOption | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) {
      toast.error('Please select a role.');
      return;
    }
    const parsed = signUpSchema.safeParse({ name, email, password, role });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input.');
      setLoading(false);
      return;
    }
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
      role,
    });

    if (error) {
      toast.error(error.message ?? 'Failed to create account.');
      setLoading(false);
      return;
    }

    toast.success('Account created! Welcome.');
    // /dashboard resolves the role server-side, so the client never has to.
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Create Account
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Join Creator Marketplace
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
              placeholder="Your full name"
              required
              autoComplete="name"
            />
          </div>

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
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">I am a…</legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('brand')}
                className={`rounded-lg border px-4 py-3 text-center text-sm font-medium transition-colors ${
                  role === 'brand'
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                Brand
              </button>
              <button
                type="button"
                onClick={() => setRole('creator')}
                className={`rounded-lg border px-4 py-3 text-center text-sm font-medium transition-colors ${
                  role === 'creator'
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                Creator
              </button>
            </div>
          </fieldset>

          <Button type="submit" disabled={loading || !role} className="w-full">
            {loading ? 'Creating account…' : 'Create Account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
