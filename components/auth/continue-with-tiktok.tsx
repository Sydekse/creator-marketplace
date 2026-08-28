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
        onClick={() =>
          toast('TikTok sign-in is in testing. Use email and password.')
        }
      >
        <TiktokLogo size={16} weight="regular" aria-hidden />
        Continue with TikTok
      </Button>
    </div>
  );
}
