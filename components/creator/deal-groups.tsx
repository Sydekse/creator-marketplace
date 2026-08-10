import Link from 'next/link';
import type {
  CreatorDealGroup,
  CreatorDealRow,
} from '@/lib/creators/dashboard';
import { GROUP_LABELS } from '@/lib/deals/groups';
import { formatEtb } from '@/lib/money';

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
        className="-mx-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md px-2 py-3 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {deal.campaignName}
          </span>
          <span className="text-xs text-muted-foreground">
            {deal.videoCount} {deal.videoCount === 1 ? 'video' : 'videos'}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm tabular-nums">
            {formatEtb(deal.totalPrice)}
          </span>
          <span className="text-xs text-muted-foreground">Deal value</span>
        </div>
      </Link>
    </li>
  );
}

function Group({ group }: { group: CreatorDealGroup }) {
  const { title, empty } = GROUP_LABELS[group.group];

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-medium">{title}</h3>
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
        <ul className="divide-y divide-border">
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
    <section className="flex flex-col gap-6">
      <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
        Your deals
      </h2>
      {groups.map((group) => (
        <Group key={group.group} group={group} />
      ))}
    </section>
  );
}
