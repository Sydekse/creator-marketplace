import { tiktokOAuthErrorMessage } from '@/lib/tiktok-oauth-error';
import { SignUpCard } from './sign-up-card';

/**
 * Server shell whose only job is reading `CREATOR_DEMO_SIGNUP` so the flag
 * never needs a NEXT_PUBLIC_ mirror. The flag reveals the email/password
 * creator path (demo/preview only); the real gate is server-side in the
 * `user.create.before` hook in lib/auth.ts.
 *
 * `error` is the Better Auth OAuth return (cancel/deny/provider). Mapped here
 * so the card never sees a raw code.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    role?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const raw = params.error;
  const code = Array.isArray(raw) ? raw[0] : raw;
  const rawRole = Array.isArray(params.role) ? params.role[0] : params.role;
  // Deep links from marketing preselect the account type on the slider.
  const initialRole =
    rawRole === 'creator' || rawRole === 'brand' ? rawRole : undefined;

  return (
    <SignUpCard
      creatorDemoSignup={process.env.CREATOR_DEMO_SIGNUP === 'true'}
      oauthError={tiktokOAuthErrorMessage(code)}
      initialRole={initialRole}
    />
  );
}
