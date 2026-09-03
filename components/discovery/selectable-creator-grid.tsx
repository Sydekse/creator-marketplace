'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle } from '@phosphor-icons/react';
import { VideoStepper } from '@/components/campaign/video-stepper';
import { CreatorCard } from '@/components/creator/creator-card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { CAMPAIGN_NOT_DRAFT_MESSAGE } from '@/lib/campaigns/constants';
import { cn, textLinkFeedback } from '@/lib/utils';
import type { DiscoveryCreator } from '@/lib/creators/discovery';

/** sessionStorage key for marks that outlive a navigation within the tab. */
const MARKS_KEY = 'discover:marked-creators';

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

  // Marks survive the detour through "Create a brief": the create flow lands
  // back on discovery, so the shortlist a brand walked away with is waiting
  // when they return. Restored after hydration (the server render cannot see
  // sessionStorage), scoped to the tab, and cleared with the selection.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(MARKS_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    queueMicrotask(() => {
      try {
        const ids: unknown = JSON.parse(raw);
        if (
          Array.isArray(ids) &&
          ids.length > 0 &&
          ids.every((id) => typeof id === 'string')
        ) {
          setSelected(new Set(ids));
        }
      } catch {
        // Unreadable stash — start clean.
      }
    });
  }, []);

  useEffect(() => {
    try {
      if (selected.size === 0) {
        sessionStorage.removeItem(MARKS_KEY);
      } else {
        sessionStorage.setItem(MARKS_KEY, JSON.stringify([...selected]));
      }
    } catch {
      // Storage unavailable — marks simply do not survive navigation.
    }
  }, [selected]);

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
      <ul
        className={cn(
          'grid grid-cols-1 gap-5 sm:grid-cols-2',
          // A lone result owns the full row — the wide, sleek variant.
          creators.length === 1 && 'bd-discsolo'
        )}
      >
        {creators.map((creator, index) => {
          const isSelected = selected.has(creator.id);
          return (
            <li
              key={creator.id}
              className="relative bd-rise"
              style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
            >
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
                className={cn(
                  'bd-discmark h-full cursor-pointer',
                  isSelected && 'bd-discmark--on'
                )}
              >
                {isSelected && (
                  <span className="bd-disccheck" aria-hidden="true">
                    <CheckCircle size={22} weight="fill" aria-hidden />
                  </span>
                )}
                <CreatorCard creator={creator} detailsHref={null} />
              </div>
              <Link href={`/discover/${creator.id}`} className="bd-discdetails">
                See details
              </Link>
            </li>
          );
        })}
      </ul>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/95 px-4 py-3 shadow-[0_12px_32px_rgba(23,23,23,0.18),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur">
            {draftCampaigns.length === 0 ? (
              /* One row everywhere. The full sentence is desktop-only;
                 mobile says "No draft yet" and the button explains itself. */
              <div className="flex flex-nowrap items-center gap-3">
                <p className="flex items-center text-sm font-medium whitespace-nowrap text-neutral-50">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-tint px-1.5 text-xs font-semibold text-brand-ink">
                    {selected.size}
                  </span>
                  <span className="sr-only">
                    {selected.size === 1 ? 'creator marked' : 'creators marked'}
                  </span>
                </p>
                <p className="min-w-0 flex-1 truncate text-sm text-neutral-400">
                  <span className="sm:hidden">No draft yet</span>
                  <span className="hidden sm:inline">
                    No draft campaign to add creators to yet.
                  </span>
                </p>
                <Link
                  href="/campaigns/new"
                  className="inline-flex h-9 items-center rounded-lg bg-neutral-50 px-3 text-sm font-medium whitespace-nowrap text-neutral-900 transition-colors hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
                >
                  New campaign
                </Link>
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
            ) : (
              /* Desktop: count · campaign · stepper · actions in one row.
                 Mobile: the campaign select owns the top row beside the
                 count, controls and actions share the bottom row. */
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 sm:flex sm:flex-nowrap">
                <p className="flex items-center text-sm font-medium whitespace-nowrap text-neutral-50">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-tint px-1.5 text-xs font-semibold text-brand-ink">
                    {selected.size}
                  </span>
                  <span className="sr-only">
                    {selected.size === 1 ? 'creator marked' : 'creators marked'}
                  </span>
                </p>

                <div className="min-w-0 sm:flex-1">
                  <Select
                    value={campaignId}
                    onValueChange={(next) => {
                      if (next) setCampaignId(next);
                    }}
                  >
                    <SelectTrigger
                      aria-label="Campaign to add creators to"
                      className="h-9 w-full min-w-0 rounded-lg border-neutral-700 bg-neutral-800 px-3 text-sm font-medium text-neutral-50 hover:border-neutral-500 focus-visible:border-neutral-50 focus-visible:ring-neutral-50/20 [&_svg]:text-neutral-400"
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        {draftCampaigns.find((c) => c.id === campaignId)
                          ?.name ?? 'Choose a campaign'}
                      </span>
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      side="top"
                      className="rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,23,0.7)] ring-neutral-50/10"
                    >
                      {draftCampaigns.map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          className="rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-neutral-100 data-[highlighted]:bg-neutral-800 data-[highlighted]:text-neutral-50"
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium tracking-[0.08em] text-neutral-400 uppercase">
                    Videos
                  </span>
                  <VideoStepper
                    size="sm"
                    value={videoCount}
                    onChange={setVideoCount}
                  />
                </div>

                <div className="flex items-center justify-end gap-3">
                  <Button
                    type="button"
                    onClick={handleBulkAdd}
                    disabled={submitting || campaignId === ''}
                    size="sm"
                    className="bg-neutral-50 whitespace-nowrap text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200"
                  >
                    {submitting ? 'Adding…' : `Add ${selected.size} to cart`}
                  </Button>
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
          </div>
        </div>
      )}
    </>
  );
}
