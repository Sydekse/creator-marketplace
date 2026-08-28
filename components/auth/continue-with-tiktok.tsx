'use client';

import { TiktokLogo } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Login Kit entry, visible but off. The sandbox keys are on Vercel; the real
 * sign-in is on the `tiktok-oauth` stash branch until it merges. Clicking
 * tells the creator why the email form is the one that works.
 */
export function ContinueWithTiktok() {
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        className="w-full"
        aria-describedby="tiktok-signin-pending"
        onClick={() =>
          toast('TikTok sign-in is in testing. Use email and password.')
        }
      >
        <TiktokLogo size={16} weight="regular" aria-hidden />
        Continue with TikTok
      </Button>
      <p
        id="tiktok-signin-pending"
        className="text-[13px] leading-snug text-neutral-500"
      >
        TikTok sign-in is in testing.
      </p>
    </div>
  );
}
