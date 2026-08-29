'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TikTokIcon } from '@/components/brand/tiktok-icon';
import { authClient } from '@/lib/auth-client';

export function ContinueWithTiktok({
  note = 'Used to verify your account automatically.',
}: {
  /**
   * The reassurance line under the button. Pass `null` to render nothing —
   * sign-in omits it: a returning user does not need data-policy copy under
   * a login button.
   */
  note?: string | null;
} = {}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);

    const { error } = await authClient.signIn.social({
      provider: 'tiktok',
      callbackURL: '/dashboard',
    });
    if (error) {
      toast.error(error.message ?? 'TikTok sign-in failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={loading}
        aria-disabled={loading}
        aria-describedby={note ? 'tiktok-signin-note' : undefined}
        onClick={handleClick}
      >
        <TikTokIcon className="h-4 w-4" />
        {loading ? 'Continuing…' : 'Continue with TikTok'}
      </Button>
      {note && (
        <p
          id="tiktok-signin-note"
          className="text-center text-[13px] leading-snug text-neutral-600"
        >
          {note}
        </p>
      )}
    </div>
  );
}
