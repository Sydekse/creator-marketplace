'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CaretDown, CaretUp, CheckCircle } from '@phosphor-icons/react';
import { CreatorCard } from '@/components/creator/creator-card';
import { Button } from '@/components/ui/button';
import { CAMPAIGN_NOT_DRAFT_MESSAGE } from '@/lib/campaigns/constants';
import { cn, textLinkFeedback } from '@/lib/utils';
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
            <li key={creator.id} className="relative">
              {/* Marking lives on the checkbox; the profile link sits outside
                  it. A link inside role=checkbox is swallowed on WebKit — the
                  activation stays on the checkbox and never navigates. */}
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
                className={`h-full cursor-pointer rounded-xl transition-[box-shadow,transform] duration-300 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isSelected ? 'ring-2 ring-brand' : ''
                }`}
              >
                {isSelected && (
                  <span className="absolute -top-2 -right-2 z-10 rounded-full bg-brand text-neutral-50">
                    <CheckCircle size={22} weight="fill" aria-hidden />
                  </span>
                )}
                <CreatorCard creator={creator} detailsHref={null} />
              </div>
              <Link
                href={`/discover/${creator.id}`}
                className="absolute right-3 bottom-3 z-10 inline-flex min-h-8 items-center rounded-full border border-neutral-300 bg-neutral-50 px-3 text-xs font-medium text-neutral-900 shadow-[0_8px_20px_-12px_rgba(23,23,23,0.35)] transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-neutral-500 hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                See details
              </Link>
            </li>
          );
        })}
      </ul>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/95 px-4 py-3 shadow-[0_12px_32px_rgba(23,23,23,0.18),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur">
            <p className="text-sm font-medium text-neutral-50">
              {selected.size} marked
            </p>

            {draftCampaigns.length === 0 ? (
              <p className="text-sm text-neutral-400">
                Create a draft campaign to add creators to.
              </p>
            ) : (
              <>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-[11px] font-medium tracking-[0.08em] text-neutral-400 uppercase">
                  Add to
                  <span className="relative">
                    <select
                      value={campaignId}
                      onChange={(e) => setCampaignId(e.target.value)}
                      className="h-9 w-full appearance-none rounded-lg border border-neutral-700 bg-neutral-800 py-1 pr-8 pl-3 text-sm font-medium tracking-normal text-neutral-50 scheme-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
                    >
                      {draftCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <CaretDown
                      size={12}
                      weight="bold"
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-neutral-400"
                    />
                  </span>
                </label>

                <div className="flex flex-col gap-1 text-[11px] font-medium tracking-[0.08em] text-neutral-400 uppercase">
                  Videos each
                  <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800">
                    <button
                      type="button"
                      aria-label="Fewer videos"
                      disabled={videoCount <= 1}
                      onClick={() => setVideoCount((n) => Math.max(1, n - 1))}
                      className="grid w-8 place-items-center text-neutral-300 transition-colors duration-150 hover:bg-neutral-700 hover:text-neutral-50 active:scale-[0.98] disabled:opacity-40"
                    >
                      <CaretDown size={12} weight="bold" aria-hidden />
                    </button>
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
                      className="w-10 [appearance:textfield] border-x border-neutral-700 bg-transparent text-center text-sm font-medium tracking-normal text-neutral-50 tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      aria-label="More videos"
                      disabled={videoCount >= 100}
                      onClick={() => setVideoCount((n) => Math.min(100, n + 1))}
                      className="grid w-8 place-items-center text-neutral-300 transition-colors duration-150 hover:bg-neutral-700 hover:text-neutral-50 active:scale-[0.98] disabled:opacity-40"
                    >
                      <CaretUp size={12} weight="bold" aria-hidden />
                    </button>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={handleBulkAdd}
                  disabled={submitting || campaignId === ''}
                  size="sm"
                  className="bg-neutral-50 text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200"
                >
                  {submitting ? 'Adding…' : `Add ${selected.size} to cart`}
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className={cn(
                'text-xs font-medium text-neutral-400 hover:text-neutral-50',
                textLinkFeedback
              )}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </>
  );
}
