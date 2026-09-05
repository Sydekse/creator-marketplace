import Link from 'next/link';
import {
  CaretRight,
  CheckCircle,
  EnvelopeSimple,
  Hourglass,
  MinusCircle,
  PencilSimple,
} from '@phosphor-icons/react/dist/ssr';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { expiryLabel } from '@/lib/dates';
import {
  type InboxDealRow,
  type InboxGroup,
  VIEW_DEAL_LABEL,
} from '@/lib/deals/inbox';
import { GROUP_LABELS } from '@/lib/deals/groups';
import type { DealGroup } from '@/lib/deals/groups';
import { TruncatedText } from '@/components/ui/truncated-text';
import { formatEtb } from '@/lib/money';
import { cn } from '@/lib/utils';

const GROUP_MARK = {
  pending: EnvelopeSimple,
  in_progress: PencilSimple,
  awaiting_approval: Hourglass,
  completed: CheckCircle,
  closed: MinusCircle,
} as const satisfies Record<DealGroup, typeof EnvelopeSimple>;

const GROUP_MARK_CLASS: Record<DealGroup, string> = {
  pending: 'text-status-pending-foreground',
  in_progress: 'text-brand-ink',
  awaiting_approval: 'text-status-pending-foreground',
  completed: 'text-status-verified-foreground',
  closed: 'text-neutral-600',
};

/**
 * Row chrome per group — paper fill (the dashboard's recipe), status colour
 * carried by the avatar ring rather than a painted card or a floating spine.
 * Status is said once, by the chip above the group; the ring only hints it.
 */
const GROUP_ROW: Record<DealGroup, string> = {
  pending: 'bd-cr-dealrow--wait',
  in_progress: 'bd-cr-dealrow--live',
  awaiting_approval: 'bd-cr-dealrow--wait',
  completed: 'bd-cr-dealrow--done',
  closed: 'bd-cr-dealrow--dead',
};

/** A 2px status ring on the row's avatar — the group's colour, on the row. */
const GROUP_GHOST: Record<DealGroup, string> = {
  pending: 'bd-cr-dealempty--wait',
  in_progress: 'bd-cr-dealempty--live',
  awaiting_approval: 'bd-cr-dealempty--wait',
  completed: 'bd-cr-dealempty--done',
  closed: 'bd-cr-dealempty--dead',
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
    <span className="bd-cr-dealmeta">{expiryLabel(offerExpiresAt, now)}</span>
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
/**
 * One deal row. The card is *not* a link — it lifts on hover as an affordance,
 * but the only target is the "View deal" button (per the interaction review:
 * a clickable card with a button on it makes two controls claim one action,
 * and the row's text is not selectable when the whole thing navigates).
 */
function DealRow({
  deal,
  now,
  wash,
}: {
  deal: InboxDealRow;
  now: Date;
  wash: string;
}) {
  return (
    <li
      className={cn(
        'bd-cr-dealrow',
        // The accent is the row's own left border: a 3px status strip that
        // runs the full height and follows the corner radius. No pseudo-element.
        wash
      )}
    >
      <div className="bd-cr-dealidentity">
        {/* Larger than the default avatar (38px) now that it is the row's
            only identity mark — the status ring moved to the row border. */}
        <InitialsAvatar
          name={deal.companyName}
          className="size-[38px] text-sm"
        />
        <div className="bd-cr-dealcopy">
          <TruncatedText text={deal.campaignName} className="bd-cr-dealtitle" />
          <span className="bd-cr-dealmeta">
            {deal.companyName} · {deal.videoCount}{' '}
            {deal.videoCount === 1 ? 'video' : 'videos'}
          </span>
          {deal.status === 'pending' ? (
            <ExpiryLine offerExpiresAt={deal.offerExpiresAt} now={now} />
          ) : null}
        </div>
      </div>
      <div className="bd-cr-dealvalue">
        <span className="bd-cr-dealamount bd-mono">
          {formatEtb(deal.totalPrice)}
        </span>
        <Link
          href={`/creator/deals/${deal.id}`}
          className="bd-btn bd-btn--primary bd-cr-dealbtn"
        >
          {VIEW_DEAL_LABEL}
          {/* Distinguishes the row's link for a screen reader (and for tests
              addressing it by name) — a list of identical "View deal" links
              announces nothing about where each one goes. */}
          <span className="sr-only"> — {deal.campaignName}</span>
          <CaretRight size={12} weight="bold" aria-hidden />
        </Link>
      </div>
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
  const Mark = GROUP_MARK[group.group];

  return (
    <section className="bd-cr-group" id={group.group}>
      <div className="bd-capruler bd-cr-groupruler">
        <h2 className="bd-caprulertitle">{title}</h2>
        <span className="bd-caprulerline" aria-hidden="true" />
        {group.count > 0 ? (
          <span className="bd-caprulercount bd-mono bd-cr-groupcount">
            {group.count}
          </span>
        ) : null}
      </div>

      {group.deals.length > 0 ? (
        <ul className="bd-cr-deallist">
          {group.deals.map((deal) => (
            <DealRow
              key={deal.id}
              deal={deal}
              now={now}
              wash={GROUP_ROW[group.group]}
            />
          ))}
        </ul>
      ) : (
        <div className={cn('bd-cr-dealempty', GROUP_GHOST[group.group])}>
          <Mark
            size={12}
            weight="regular"
            aria-hidden
            className={cn('opacity-40', GROUP_MARK_CLASS[group.group])}
          />
          <p>{empty.replace(/\.$/, '')}</p>
        </div>
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
    <div className="bd-cr-inbox">
      {groups.map((group) => (
        <Group key={group.group} group={group} now={now} />
      ))}
    </div>
  );
}
