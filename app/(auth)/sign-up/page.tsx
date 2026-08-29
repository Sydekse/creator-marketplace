import { SignUpCard } from './sign-up-card';

/**
 * Server shell whose only job is reading `CREATOR_DEMO_SIGNUP` so the flag
 * never needs a NEXT_PUBLIC_ mirror. The flag reveals the email/password
 * creator path (demo/preview only); the real gate is server-side in the
 * `user.create.before` hook in lib/auth.ts.
 */
export default function SignUpPage() {
  return (
    <SignUpCard
      creatorDemoSignup={process.env.CREATOR_DEMO_SIGNUP === 'true'}
    />
  );
}
