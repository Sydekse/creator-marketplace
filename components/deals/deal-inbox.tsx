import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { expiryLabel } from '@/lib/dates';
import {
  type InboxDealRow,
  type InboxGroup,
  VIEW_DEAL_LABEL,
} from '@/lib/deals/inbox';
import { GROUP_LABELS } from '@/lib/deals/groups';
import { TruncatedText } from '@/components/ui/truncated-text';
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
    <li className="border-b border-neutral-200 last:border-b-0">
      <Link
        href={`/creator/deals/${deal.id}`}
        className="group flex min-h-20 cursor-pointer flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl px-3 py-4 transition-[background-color,box-shadow] duration-200 ease-[var(--ease-smooth)] hover:bg-neutral-50 hover:shadow-[0_16px_32px_-24px_rgba(23,23,23,0.35)] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none"
      >
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={deal.companyName} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <TruncatedText
              text={deal.campaignName}
              className="text-sm font-semibold text-neutral-900"
            />
            <span className="text-xs text-muted-foreground">
              {deal.companyName} · {deal.videoCount}{' '}
              {deal.videoCount === 1 ? 'video' : 'videos'}
            </span>
            {deal.status === 'pending' ? (
              <ExpiryLine offerExpiresAt={deal.offerExpiresAt} now={now} />
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
            {formatEtb(deal.totalPrice)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors group-hover:text-neutral-900">
            {VIEW_DEAL_LABEL}
            <CaretRight size={12} weight="bold" aria-hidden />
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
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-3">
        <h2 className="text-[13px] font-semibold tracking-[0.12em] text-neutral-700 uppercase">
          {title}
        </h2>
        {group.count > 0 ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {group.count}
          </span>
        ) : null}
      </div>

      {group.deals.length > 0 ? (
        <ul>
          {group.deals.map((deal) => (
            <DealRow key={deal.id} deal={deal} now={now} />
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">{empty}</p>
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
    <div className="flex flex-col gap-10">
      {groups.map((group) => (
        <Group key={group.group} group={group} now={now} />
      ))}
    </div>
  );
}
