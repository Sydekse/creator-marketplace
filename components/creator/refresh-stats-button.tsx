'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

/**
 * "Refresh stats" (phase 3) — the creator's self-serve re-pull of their
 * TikTok numbers, an icon-sized action in the profile card's header, for
 * TikTok-linked accounts only (the server decides; email sign-ups never
 * render this). Deliberately small: refreshing is secondary to reading the
 * card, so it must not command the attention of a full-width button.
 *
 * The heavy lifting — rate limit, fetch, tier consequences — is all
 * `POST /api/creators/stats/refresh`. This component only reports what the
 * server said, as toasts (an icon has no room for inline copy):
 *
 *   - success → `router.refresh()`, so the numbers on the card are the ones
 *     the server just wrote, not a client-side copy that could drift. An
 *     upgrade gets a line naming the new tier; a flag-for-review deliberately
 *     shows nothing (the review is the admin's until decided).
 *   - 429 → the envelope's message plus the `Retry-After` header turned into
 *     hours, so the answer is "when", not just "no".
 *   - anything else → the envelope's message as-is.
 */
export function RefreshStatsButton({
  lastRefreshedLabel,
}: {
  lastRefreshedLabel: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/creators/stats/refresh', {
          method: 'POST',
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          const message =
            body?.error?.message ?? 'Something went wrong. Try again later.';
          if (response.status === 429) {
            const seconds = Number(response.headers.get('Retry-After'));
            const wait = Number.isFinite(seconds)
              ? ` You can refresh again in about ${Math.max(1, Math.ceil(seconds / 3600))}h.`
              : '';
            toast.error(message + wait);
          } else {
            toast.error(message);
          }
          return;
        }

        const body = (await response.json()) as {
          tier_change:
            | { kind: 'upgraded'; tier_name: string }
            | { kind: string };
        };
        toast.success(
          body.tier_change.kind === 'upgraded' &&
            'tier_name' in body.tier_change
            ? `Stats updated — you moved up to the ${body.tier_change.tier_name} tier!`
            : 'Stats updated from TikTok.'
        );
        router.refresh();
      } catch {
        toast.error(
          'Could not reach the server. Check your connection and try again.'
        );
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {lastRefreshedLabel ? (
        <span className="text-[11px] leading-none text-muted-foreground">
          Updated {lastRefreshedLabel}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 rounded-full text-muted-foreground hover:text-foreground"
        onClick={refresh}
        disabled={pending}
        aria-label="Refresh my stats"
        title="Refresh my stats from TikTok"
      >
        <ArrowsClockwise
          size={15}
          weight="regular"
          aria-hidden
          className={pending ? 'animate-spin' : undefined}
        />
      </Button>
    </div>
  );
}
