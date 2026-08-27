'use client';

import { useState } from 'react';
import { TiktokLogo } from '@phosphor-icons/react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

/**
 * Login Kit entry. Creators only — brands stay on email/password.
 * callbackURL is a same-origin path; /dashboard assigns the role home.
 */
export function ContinueWithTiktok({
  callbackURL = '/dashboard',
}: {
  callbackURL?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setError(null);
    setPending(true);
    const { error: nextError } = await authClient.signIn.social({
      provider: 'tiktok',
      callbackURL,
    });
    if (nextError) {
      setError(
        nextError.message ?? 'Could not start TikTok sign-in. Try again.'
      );
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        className="w-full"
        onClick={start}
        disabled={pending}
      >
        <TiktokLogo size={16} weight="regular" aria-hidden />
        {pending ? 'Opening TikTok…' : 'Continue with TikTok'}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
