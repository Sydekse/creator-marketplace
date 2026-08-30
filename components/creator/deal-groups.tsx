import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import type {
  CreatorDealGroup,
  CreatorDealRow,
} from '@/lib/creators/dashboard';
import { GROUP_LABELS } from '@/lib/deals/groups';
import type { DealGroup } from '@/lib/deals/groups';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { SectionLabel } from '@/components/layout/section-label';
import { buttonVariants } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { formatEtb } from '@/lib/money';
import { cn } from '@/lib/utils';

const GROUP_PILL: Record<DealGroup, ChipTone> = {
  pending: 'amber',
  in_progress: 'teal',
  awaiting_approval: 'amber',
  completed: 'success',
  closed: 'gray',
};

/**
 * A creator's deals, grouped by state (KAN-25, AC-2).
 *
 * A compact row per deal, and since KAN-39 each row links into
 * `/creator/deals/[id]` — the detail view that ticket built. The row itself is
 * unchanged: which campaign, how many videos, what it is worth, which is what a
 * creator needs to recognise a deal. Everything about deciding on it is one tap
 * away rather than duplicated here, so this stays a summary and the inbox stays
 * the screen for working through offers.
 *
 * The amount is `total_price` — the deal's gross value, snapshotted at offer
 * time — and it is labelled as such. It is deliberately not a payout estimate:
 * the payout figures on this page come from the ledger, and putting a computed
 * number beside them is how a shown figure and a paid figure drift apart. A
 * creator's per-video net is on the rate table further up the page.
 *
 * Every group renders, including empty ones, so the headings do not reshuffle
 * as deals move through the machine. An empty group is one muted line rather
 * than a heading over nothing.
 */

function DealRow({ deal }: { deal: CreatorDealRow }) {
  return (
    <li>
      {/* The whole row is the target rather than a button at its end: on a phone
          that is a full-width tap target instead of a 40px one (NFR-007). */}
      <Link
        href={`/creator/deals/${deal.id}`}
        className="surface-card group flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-neutral-200 px-4 py-3 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_16px_32px_-20px_rgba(23,23,23,0.4)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <TruncatedText
            text={deal.campaignName}
            className="text-sm font-semibold text-neutral-900"
          />
          <span className="text-xs text-muted-foreground">
            {deal.videoCount} {deal.videoCount === 1 ? 'video' : 'videos'}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-sm font-medium tabular-nums">
            {formatEtb(deal.totalPrice)}
          </span>
          <span
            className={cn(
              buttonVariants({ variant: 'outline', size: 'xs' }),
              'pointer-events-none'
            )}
          >
            Open deal
            <CaretRight size={12} weight="bold" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

function Group({ group }: { group: CreatorDealGroup }) {
  const { title, empty } = GROUP_LABELS[group.group];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h3>
          <Chip tone={GROUP_PILL[group.group]} size="md">
            {title}
          </Chip>
        </h3>
        {/* The count is the useful part of a heading a creator is scanning:
            "how many are waiting on me". Hidden when zero, because the empty
            line below already says it and "0" twice reads as an error. */}
        {group.count > 0 ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {group.count}
          </span>
        ) : null}
      </div>

      {group.deals.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {group.deals.map((deal) => (
            <DealRow key={deal.id} deal={deal} />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export function DealGroups({ groups }: { groups: CreatorDealGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionLabel>Your deals</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <Group key={group.group} group={group} />
        ))}
      </div>
    </div>
  );
}
