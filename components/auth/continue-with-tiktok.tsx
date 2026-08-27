import { TiktokLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

/**
 * Login Kit entry, shown but not wired. The click is off until TikTok sandbox
 * keys are live — the button stays visible so the creator path is obvious.
 */
export function ContinueWithTiktok() {
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled
        aria-disabled="true"
        aria-describedby="tiktok-signin-pending"
      >
        <TiktokLogo size={16} weight="regular" aria-hidden />
        Continue with TikTok
      </Button>
      <p
        id="tiktok-signin-pending"
        className="text-[13px] leading-snug text-neutral-500"
      >
        TikTok sign-in is not available yet.
      </p>
    </div>
  );
}
