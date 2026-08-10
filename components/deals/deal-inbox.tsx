import Link from 'next/link';
import { expiryLabel } from '@/lib/dates';
import {
  type InboxDealRow,
  type InboxGroup,
  VIEW_DEAL_LABEL,
} from '@/lib/deals/inbox';
import { GROUP_LABELS } from '@/lib/deals/groups';
import { formatEtb } from '@/lib/money';

/**
 * The creator's deals, grouped, pending first (KAN-39, US-006, AC-1).
 *
 * A server component: every row is a link and a handful of strings, and nothing
 * here handles an event. The dashboard's `DealGroups` is the same idea one
 * screen over, and the two share `GROUP_LABELS` and `groupDeals` rather than
 * being one component with a mode flag — this one carries the brand, the
 * deadline and a link, and folding that into the dashboard's compact row would
 * make both worse.
 *
 * **The order is not sorted here.** `DEAL_GROUPS` puts `pending` at the head,
 * so "pending offers first" falls out of the vocabulary rather than out of a
 * comparator a later edit could reorder. Within a group, rows arrive newest
 * first from the query.
 *
 * `now` is a prop rather than a `new Date()` inside, so the expiry tense is
 * decided once per render for the whole page and a test can pin it. The page
 * reads the clock; this renders what it is given.
 */

function ExpiryLine({
  offerExpiresAt,
  now,
}: {
  offerExpiresAt: Date | null;
  now: Date;
}) {
  return (
    <span className="text-xs text-muted-foreground">
      {expiryLabel(offerExpiresAt, now)}
    </span>
  );
}

/**
 * One deal, as a link into the detail view (AC-1 → AC-2).
 *
 * The whole row is the target rather than a `View deal` button at its end: on a
 * phone that is a full-width tap target instead of a 40px one (NFR-007). The
 * label still exists as a constant and is rendered for a screen reader, because
 * "campaign name, 3 videos, ETB 9,000" read aloud does not announce that it is
 * a link to anything.
 *
 * The deadline shows on `pending` rows only. On an accepted deal the offer
 * window has already been answered, so repeating it there would read as a
 * second deadline the creator has to meet.
 */
function DealRow({ deal, now }: { deal: InboxDealRow; now: Date }) {
  return (
    <li>
      <Link
        href={`/creator/deals/${deal.id}`}
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md px-2 py-3 -mx-2 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {deal.campaignName}
          </span>
          <span className="text-xs text-muted-foreground">
            {deal.companyName} · {deal.videoCount}{' '}
            {deal.videoCount === 1 ? 'video' : 'videos'}
          </span>
          {deal.status === 'pending' ? (
            <ExpiryLine offerExpiresAt={deal.offerExpiresAt} now={now} />
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm tabular-nums">
            {formatEtb(deal.totalPrice)}
          </span>
          <span className="text-xs text-muted-foreground">
            {VIEW_DEAL_LABEL}
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * Every group renders, including empty ones, so the headings do not reshuffle
 * as deals move through the machine — the `DealGroups` precedent. An empty
 * group is one muted line rather than a heading over nothing.
 */
function Group({ group, now }: { group: InboxGroup; now: Date }) {
  const { title, empty } = GROUP_LABELS[group.group];

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {group.count > 0 ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {group.count}
          </span>
        ) : null}
      </div>

      {group.deals.length > 0 ? (
        <ul className="divide-y divide-border">
          {group.deals.map((deal) => (
            <DealRow key={deal.id} deal={deal} now={now} />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export function DealInbox({
  groups,
  now,
}: {
  groups: InboxGroup[];
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <Group key={group.group} group={group} now={now} />
      ))}
    </div>
  );
}
