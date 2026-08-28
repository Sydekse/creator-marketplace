'use client';

import { useState } from 'react';
import { TiktokLogo } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

/**
 * One line to flip for the demo. `true` is real Login Kit OAuth; `false`
 * keeps the button clickable, shows it loading, then the creator sign-up
 * swaps to email/password. Missing TikTok keys force `false` at runtime.
 * Remove this constant once the demo is done.
 */
const TIKTOK_OAUTH_ENABLED = true;

/** Whether a real OAuth attempt is even possible in this deployment. */
export function tiktokOAuthAvailable() {
  return Boolean(TIKTOK_OAUTH_ENABLED);
}

export function ContinueWithTiktok({
  onDemoFallback,
  disabledNote,
}: {
  /**
   * Called after the click when OAuth is off (the demo path). On the sign-up
   * card this reveals the creator email/password form. Omit to keep the
   * button disabled with a testing-phase note (the sign-in page).
   */
  onDemoFallback?: () => void;
  /** The note under a disabled button (the sign-in page's testing copy). */
  disabledNote?: string;
}) {
  const [loading, setLoading] = useState(false);
  const available = tiktokOAuthAvailable();
  const demoable = onDemoFallback !== undefined;

  async function handleClick() {
    if (loading) return;
    setLoading(true);

    if (available) {
      const { error } = await authClient.signIn.social({
        provider: 'tiktok',
        callbackURL: '/dashboard',
      });
      if (error) {
        toast.error(
          error.message ?? 'TikTok sign-in failed. Please try again.'
        );
        setLoading(false);
      }
      return;
    }

    if (demoable) {
      onDemoFallback();
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={(!available && !demoable) || loading}
        aria-disabled={(!available && !demoable) || loading}
        aria-describedby="tiktok-signin-pending"
        onClick={handleClick}
      >
        <TiktokLogo size={16} weight="regular" aria-hidden />
        {loading ? 'Continuing…' : 'Continue with TikTok'}
      </Button>
      <p
        id="tiktok-signin-pending"
        className="text-[13px] leading-snug text-neutral-500"
      >
        {!available && !demoable
          ? (disabledNote ?? 'TikTok sign-in is not available yet.')
          : 'TikTok does not share an email. We will ask for one later if we need to reach you.'}
      </p>
    </div>
  );
}
