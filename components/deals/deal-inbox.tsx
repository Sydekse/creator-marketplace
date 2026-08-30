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
  pending:
    'border-neutral-200 bg-background border-l-[3px] border-l-[color-mix(in_oklch,var(--status-pending-foreground)_85%,var(--border))] hover:border-[color-mix(in_oklch,var(--status-pending-foreground)_50%,var(--border))] hover:border-l-[color-mix(in_oklch,var(--status-pending-foreground)_85%,var(--border))]',
  in_progress:
    'border-neutral-200 bg-background border-l-[3px] border-l-brand/85 hover:border-brand/50 hover:border-l-brand/85',
  awaiting_approval:
    'border-neutral-200 bg-background border-l-[3px] border-l-[color-mix(in_oklch,var(--status-pending-foreground)_85%,var(--border))] hover:border-[color-mix(in_oklch,var(--status-pending-foreground)_50%,var(--border))] hover:border-l-[color-mix(in_oklch,var(--status-pending-foreground)_85%,var(--border))]',
  completed:
    'border-neutral-200 bg-background border-l-[3px] border-l-[color-mix(in_oklch,var(--status-verified-foreground)_80%,var(--border))] hover:border-[color-mix(in_oklch,var(--status-verified-foreground)_50%,var(--border))] hover:border-l-[color-mix(in_oklch,var(--status-verified-foreground)_80%,var(--border))]',
  closed:
    'border-neutral-200 bg-background border-l-[3px] border-l-neutral-300 hover:border-neutral-300 hover:border-l-neutral-300',
};

/** A 2px status ring on the row's avatar — the group's colour, on the row. */
const GROUP_GHOST: Record<DealGroup, string> = {
  pending:
    'border-[color-mix(in_oklch,var(--status-pending-foreground)_22%,var(--border))] bg-[color-mix(in_oklch,var(--status-pending)_42%,white)]',
  in_progress:
    'border-[color-mix(in_oklch,var(--brand)_22%,var(--border))] bg-[color-mix(in_oklch,var(--brand-tint)_45%,white)]',
  awaiting_approval:
    'border-[color-mix(in_oklch,var(--status-pending-foreground)_22%,var(--border))] bg-[color-mix(in_oklch,var(--status-pending)_42%,white)]',
  completed:
    'border-[color-mix(in_oklch,var(--status-verified-foreground)_22%,var(--border))] bg-[color-mix(in_oklch,var(--status-verified)_45%,white)]',
  closed: 'border-neutral-200 bg-neutral-50',
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
        'group relative flex min-h-20 flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border px-4 py-3 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-20px_rgba(23,23,23,0.4)]',
        // The accent is the row's own left border: a 3px status strip that
        // runs the full height and follows the corner radius. No pseudo-element.
        wash
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Larger than the default avatar (38px) now that it is the row's
            only identity mark — the status ring moved to the row border. */}
        <InitialsAvatar
          name={deal.companyName}
          className="size-[38px] text-sm"
        />
        <div className="flex min-w-0 flex-col gap-1">
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
      <div className="flex flex-col items-end gap-1">
        <span className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
          {formatEtb(deal.totalPrice)}
        </span>
        <Link
          href={`/creator/deals/${deal.id}`}
          className={cn(
            buttonVariants({ size: 'sm' }),
            'bg-brand-deep text-neutral-50 group-hover:bg-brand-strong'
          )}
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
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2>
          <Chip
            tone={GROUP_PILL[group.group]}
            size="md"
            className="font-semibold tracking-[0.06em]"
          >
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
            <DealRow
              key={deal.id}
              deal={deal}
              now={now}
              wash={GROUP_ROW[group.group]}
            />
          ))}
        </ul>
      ) : (
        <div
          className={cn(
            'flex min-h-20 items-center gap-3 rounded-2xl border border-dashed px-4 py-3',
            GROUP_GHOST[group.group]
          )}
        >
          <Mark
            size={12}
            weight="regular"
            aria-hidden
            className={cn('opacity-40', GROUP_MARK_CLASS[group.group])}
          />
          <p className="text-sm text-muted-foreground italic">
            {empty.replace(/\.$/, '')}
          </p>
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
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-8 lg:gap-y-10">
      {groups.map((group) => (
        <Group key={group.group} group={group} now={now} />
      ))}
    </div>
  );
}
