'use client';

import { useState } from 'react';
import { TiktokLogo } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function ContinueWithTiktok() {
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
        aria-describedby="tiktok-signin-note"
        onClick={handleClick}
      >
        <TiktokLogo size={16} weight="regular" aria-hidden />
        {loading ? 'Continuing…' : 'Continue with TikTok'}
      </Button>
      <p
        id="tiktok-signin-note"
        className="text-[13px] leading-snug text-neutral-500"
      >
        TikTok does not share an email. We will ask for one later if we need to
        reach you.
      </p>
    </div>
  );
}
