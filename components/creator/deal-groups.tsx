import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import type {
  CreatorDealGroup,
  CreatorDealRow,
} from '@/lib/creators/dashboard';
import { GROUP_LABELS } from '@/lib/deals/groups';
import type { DealGroup } from '@/lib/deals/groups';
import { TruncatedText } from '@/components/ui/truncated-text';
import { formatEtb } from '@/lib/money';
import { cn } from '@/lib/utils';

const GROUP_SURFACE: Record<DealGroup, string> = {
  pending:
    'border-[color-mix(in_oklch,var(--status-pending-foreground)_22%,transparent)] bg-[color-mix(in_oklch,var(--status-pending)_72%,white)]',
  in_progress:
    'border-brand/20 bg-[color-mix(in_oklch,var(--brand-tint)_70%,white)]',
  awaiting_approval:
    'border-[color-mix(in_oklch,var(--status-pending-foreground)_22%,transparent)] bg-[color-mix(in_oklch,var(--status-pending)_55%,white)]',
  completed:
    'border-[color-mix(in_oklch,var(--status-verified-foreground)_22%,transparent)] bg-[color-mix(in_oklch,var(--status-verified)_70%,white)]',
  closed: 'border-neutral-200 bg-neutral-100/80',
};

const GROUP_EYEBROW: Record<DealGroup, string> = {
  pending: 'text-status-pending-foreground',
  in_progress: 'text-brand-ink',
  awaiting_approval: 'text-status-pending-foreground',
  completed: 'text-status-verified-foreground',
  closed: 'text-neutral-500',
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
        className="group flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl px-2 py-2.5 transition-[background-color,box-shadow] duration-200 ease-[var(--ease-smooth)] hover:bg-neutral-50/80 hover:shadow-[0_16px_32px_-24px_rgba(23,23,23,0.35)] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <TruncatedText
            text={deal.campaignName}
            className="text-sm font-semibold text-neutral-900"
          />
          <span className="text-xs text-muted-foreground">
            {deal.videoCount} {deal.videoCount === 1 ? 'video' : 'videos'}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm font-medium tabular-nums">
            {formatEtb(deal.totalPrice)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors group-hover:text-neutral-900">
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
    <section
      className={cn(
        'flex flex-col gap-2 rounded-[20px] border p-4',
        GROUP_SURFACE[group.group],
        group.count === 0 && 'border-dashed opacity-70'
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className={cn('text-sm font-semibold', GROUP_EYEBROW[group.group])}>
          {title}
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
        <ul className="divide-y divide-black/5">
          {group.deals.map((deal) => (
            <DealRow key={deal.id} deal={deal} />
          ))}
        </ul>
      ) : (
        <p className="py-0.5 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export function DealGroups({ groups }: { groups: CreatorDealGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
        Your deals
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <Group key={group.group} group={group} />
        ))}
      </div>
    </div>
  );
}
