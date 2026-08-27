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
import type { DealGroup } from '@/lib/deals/groups';
import { Chip, type ChipTone } from '@/components/ui/chip';
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
        className="surface-card group flex min-h-20 cursor-pointer flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-neutral-200 px-3 py-3 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_16px_32px_-20px_rgba(23,23,23,0.4)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
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
          <span
            className={cn(
              buttonVariants({ variant: 'outline', size: 'xs' }),
              'pointer-events-none'
            )}
          >
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
      <div className="flex items-center justify-between gap-4">
        <h2>
          <Chip tone={GROUP_PILL[group.group]} size="md">
            {title}
          </Chip>
        </h2>
        {group.count > 0 ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {group.count}
          </span>
        ) : null}
      </div>

      {group.deals.length > 0 ? (
        <ul className="flex flex-col gap-2">
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
