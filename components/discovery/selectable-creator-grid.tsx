'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle } from '@phosphor-icons/react';
import { CreatorCard } from '@/components/creator/creator-card';
import { Button } from '@/components/ui/button';
import { CAMPAIGN_NOT_DRAFT_MESSAGE } from '@/lib/campaigns/constants';
import type { DiscoveryCreator } from '@/lib/creators/discovery';

/**
 * The discover grid's mark-and-add flow.
 *
 * Clicking a tile marks it; marking accumulates across tiles, filters and pages
 * (selection lives here, not in the URL — it is a shopping gesture, not a
 * shareable view). "See details" is the explicit way into a profile now that
 * the tile itself no longer navigates.
 *
 * The batch posts to `/items/bulk`, which is atomic: one unbookable creator or
 * a broken budget ceiling refuses the whole add, and the toast names what the
 * server said. A creator already in the cart has their count grown — the
 * single-add upsert semantics, applied to the batch.
 *
 * `'use client'` because selection is client state. The page above stays a
 * Server Component: filters remain a native GET form and only this grid (the
 * cards plus the action bar) ships as a client island.
 */
export function SelectableCreatorGrid({
  creators,
  draftCampaigns,
}: {
  creators: DiscoveryCreator[];
  /** The brand's draft campaigns, for the bar's "add to" picker. */
  draftCampaigns: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [campaignId, setCampaignId] = useState(draftCampaigns[0]?.id ?? '');
  const [videoCount, setVideoCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const handleByCreator = useMemo(
    () => new Map(creators.map((c) => [c.id, c.tiktokHandle])),
    [creators]
  );

  function toggle(creatorId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(creatorId)) {
        next.delete(creatorId);
      } else {
        next.add(creatorId);
      }
      return next;
    });
  }

  async function handleBulkAdd() {
    if (submitting || selected.size === 0 || campaignId === '') return;
    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(`/api/campaigns/${campaignId}/items/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorIds: [...selected],
          videoCount,
        }),
      });
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const code = body?.error?.code;
      if (code === 'CREATOR_NOT_BOOKABLE') {
        // The batch is atomic and names the creator it stopped on — map the id
        // back to a handle so the brand knows which tile to unmark.
        const failedId = body?.error?.details?.creator?.[0];
        const handle = failedId ? handleByCreator.get(failedId) : undefined;
        toast.error(
          handle
            ? `${handle} is not currently bookable. Unmark them and try again.`
            : 'One of the marked creators is not currently bookable.'
        );
      } else if (code === 'CAMPAIGN_NOT_DRAFT') {
        toast.error(CAMPAIGN_NOT_DRAFT_MESSAGE);
      } else {
        // `BUDGET_EXCEEDED` carries the server's own sentence with the exact
        // shortfall — shown as sent, on the single-add precedent.
        toast.error(body?.error?.message ?? 'Failed to add creators.');
      }
      setSubmitting(false);
      return;
    }

    const added: number = body?.added ?? 0;
    const updated: number = body?.updated ?? 0;
    toast.success(
      [
        added > 0 ? `${added} added to the cart` : null,
        updated > 0
          ? `${updated} already carted — video count${updated === 1 ? '' : 's'} grew`
          : null,
      ]
        .filter(Boolean)
        .join('; ') + '.'
    );
    setSelected(new Set());
    setSubmitting(false);
    // The top-bar cart badge and the cart itself are server-rendered.
    router.refresh();
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {creators.map((creator) => {
          const isSelected = selected.has(creator.id);
          return (
            <li key={creator.id}>
              {/* The tile is a toggle, not a link. A click that lands on a real
                  link inside the card (View on TikTok, See details) is left to
                  navigate — `closest('a')` is what stops it also marking. */}
              <div
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`Mark ${creator.tiktokHandle}`}
                tabIndex={0}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('a')) return;
                  toggle(creator.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    if ((event.target as HTMLElement).closest('a')) return;
                    event.preventDefault();
                    toggle(creator.id);
                  }
                }}
                className={`relative h-full cursor-pointer rounded-xl transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isSelected ? 'ring-2 ring-brand' : ''
                }`}
              >
                {isSelected && (
                  <span className="absolute -top-2 -right-2 z-10 rounded-full bg-brand text-neutral-50">
                    <CheckCircle size={22} weight="fill" aria-hidden />
                  </span>
                )}
                <CreatorCard creator={creator} detailsHref={null} />
                <div className="absolute right-3 bottom-3 z-10">
                  <Link
                    href={`/discover/${creator.id}`}
                    className="text-xs font-medium text-brand-ink underline-offset-4 hover:underline"
                  >
                    See details
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/95 px-4 py-3 shadow-[0_12px_32px_rgba(23,23,23,0.18)] backdrop-blur">
            <p className="text-sm font-medium text-neutral-50">
              {selected.size} marked
            </p>

            {draftCampaigns.length === 0 ? (
              <p className="text-sm text-neutral-400">
                Create a draft campaign to add creators to.
              </p>
            ) : (
              <>
                <label className="flex min-w-40 flex-1 items-center gap-2 text-xs text-neutral-400">
                  <span className="shrink-0">Add to</span>
                  <select
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-50"
                  >
                    {draftCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <span className="shrink-0">Videos each</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={videoCount}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setVideoCount(
                        Number.isInteger(next) && next >= 1 && next <= 100
                          ? next
                          : 1
                      );
                    }}
                    className="h-9 w-16 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-50"
                  />
                </label>

                <Button
                  type="button"
                  onClick={handleBulkAdd}
                  disabled={submitting || campaignId === ''}
                  size="sm"
                >
                  {submitting ? 'Adding…' : `Add ${selected.size} to cart`}
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-neutral-400 underline-offset-4 hover:text-neutral-50 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </>
  );
}
