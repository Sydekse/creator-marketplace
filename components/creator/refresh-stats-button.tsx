'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

/**
 * "Refresh my stats" (phase 3) — the creator's self-serve re-pull of their
 * TikTok numbers, shown on the dashboard profile card for TikTok-linked
 * accounts only (the server decides; email sign-ups never render this).
 *
 * The heavy lifting — rate limit, fetch, tier consequences — is all
 * `POST /api/creators/stats/refresh`. This component only reports what the
 * server said:
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
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'error' | 'success';
    text: string;
  } | null>(null);

  async function refresh() {
    setPending(true);
    setNotice(null);
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
          setNotice({ tone: 'error', text: message + wait });
        } else {
          setNotice({ tone: 'error', text: message });
        }
        return;
      }

      const body = (await response.json()) as {
        tier_change: { kind: 'upgraded'; tier_name: string } | { kind: string };
      };
      setNotice({
        tone: 'success',
        text:
          body.tier_change.kind === 'upgraded' && 'tier_name' in body.tier_change
            ? `Stats updated — you moved up to the ${body.tier_change.tier_name} tier!`
            : 'Stats updated from TikTok.',
      });
      router.refresh();
    } catch {
      setNotice({
        tone: 'error',
        text: 'Could not reach the server. Check your connection and try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="dash-action w-full gap-2"
        onClick={refresh}
        disabled={pending}
      >
        <ArrowsClockwise
          size={16}
          weight="regular"
          aria-hidden
          className={pending ? 'animate-spin' : undefined}
        />
        {pending ? 'Refreshing…' : 'Refresh my stats'}
      </Button>
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === 'error'
              ? 'text-xs leading-snug text-destructive'
              : 'text-xs leading-snug text-brand-ink'
          }
        >
          {notice.text}
        </p>
      ) : lastRefreshedLabel ? (
        <p className="text-xs leading-snug text-muted-foreground">
          Last updated from TikTok {lastRefreshedLabel}.
        </p>
      ) : null}
    </div>
  );
}
