import type { DealStatus } from '@/db/schema';

/**
 * How a creator's deals are grouped by state (KAN-25 AC-2, KAN-39 AC-1).
 *
 * AC-2 names four groups — pending offers, accepted/in-progress, awaiting
 * approval, completed — and the deal state machine has nine statuses. The
 * machine wins: every status has to render somewhere, so a fifth group holds
 * the three terminal states the AC does not name. Without it, a deal that was
 * declined or expired would silently vanish from the only screen a creator has
 * to see it on.
 *
 * Pure domain vocabulary, deliberately with no database imports and no runtime
 * import of the state machine — the type-only `DealStatus` above is erased.
 * That purity is enforced by a test, and it is what lets both creator screens
 * and any future client component share this mapping without dragging
 * `drizzle-orm` and the schema into a bundle.
 *
 * The deal inbox is the second caller the KAN-25 docstring anticipated, so
 * `groupDeals` moved here from `lib/creators/dashboard.ts` on KAN-39 — the
 * "extract at the second caller" rule. It is generic over anything carrying a
 * status, because the two screens select different columns and the only part
 * that must not drift is the partition.
 */

export const DEAL_GROUPS = [
  'pending',
  'in_progress',
  'awaiting_approval',
  'completed',
  'closed',
] as const;

export type DealGroup = (typeof DEAL_GROUPS)[number];

/**
 * `satisfies Record<DealStatus, DealGroup>` is not decoration: a tenth deal
 * status added to the union becomes a compile error here rather than a deal
 * that renders in no group at all. That is the same exhaustiveness the state
 * machine tests use, applied at the vocabulary layer where the failure would
 * otherwise be silent.
 */
const GROUP_BY_STATUS = {
  pending: 'pending',
  accepted: 'in_progress',
  funded: 'in_progress',
  revision_requested: 'in_progress',
  delivered: 'awaiting_approval',
  completed: 'completed',
  declined: 'closed',
  expired: 'closed',
  refunded: 'closed',
} satisfies Record<DealStatus, DealGroup>;

export function groupForStatus(status: DealStatus): DealGroup {
  return GROUP_BY_STATUS[status];
}

/**
 * Partitions rows into all five groups, in `DEAL_GROUPS` order.
 *
 * Every group is present even when empty, so a screen renders a stable set of
 * headings rather than a layout that reshuffles as deals move through the
 * machine. Pure, so the mapping is testable without a database.
 *
 * Generic over anything carrying a status. The dashboard selects five columns
 * and the inbox selects more, and neither projection is the other's business —
 * what must not drift between the two screens is which status lands in which
 * group, and that is the whole of what this shares.
 */
export function groupDeals<T extends { status: DealStatus }>(
  rows: T[]
): Array<{ group: DealGroup; deals: T[]; count: number }> {
  return DEAL_GROUPS.map((group) => {
    const deals = rows.filter((row) => groupForStatus(row.status) === group);
    return { group, deals, count: deals.length };
  });
}

/**
 * Copy held beside the mapping, following the `NO_MATCHES_TITLE` precedent in
 * `lib/creators/discovery.ts`: a user-facing string defined once cannot be
 * paraphrased apart from itself by a later edit.
 *
 * `revision_requested` groups with in-progress, not awaiting-approval, because
 * the grouping is by *who must act next*: the brand rejected the deliverable,
 * so the creator re-delivers. Filing it under "awaiting approval" would tell a
 * creator to wait when they are the blocker.
 */
export const GROUP_LABELS: Record<DealGroup, { title: string; empty: string }> =
  {
    pending: {
      title: 'Pending offers',
      empty: 'No pending offers.',
    },
    in_progress: {
      title: 'Accepted · in progress',
      empty: 'Nothing accepted yet.',
    },
    awaiting_approval: {
      title: 'Awaiting approval',
      empty: 'Nothing waiting on the brand.',
    },
    completed: {
      title: 'Completed',
      empty: 'No completed deals yet.',
    },
    closed: {
      title: 'Closed',
      empty: 'Nothing closed.',
    },
  };

/**
 * One status, named for a person (KAN-39, AC-5).
 *
 * The history timeline reads `deal_event.to_status`, which is a raw column
 * value: rendering it unmapped puts `revision_requested` in front of a creator.
 * Held here beside the grouping rather than in the component, because the same
 * nine statuses will be named on the brand's deal view too, and two screens
 * calling the same state different things is the version of this that is hard
 * to notice.
 *
 * `satisfies` again, for the same reason `GROUP_BY_STATUS` uses it: a tenth
 * status is a compile error, not a blank chip.
 */
const STATUS_LABELS = {
  pending: 'Offer sent',
  accepted: 'Offer accepted',
  declined: 'Offer declined',
  expired: 'Offer expired',
  funded: 'Funded',
  delivered: 'Video submitted',
  revision_requested: 'Changes requested',
  completed: 'Completed',
  refunded: 'Refunded',
} satisfies Record<DealStatus, string>;

/**
 * Takes a plain `string`, not a `DealStatus`, because that is what the history
 * column is typed as after it leaves the database. An unrecognised value falls
 * back to itself: a status this build has never heard of is a row written by a
 * newer deploy, and showing it verbatim is more honest than dropping the event
 * or rendering an empty line where a transition happened.
 */
export function labelForStatus(status: string): string {
  return STATUS_LABELS[status as DealStatus] ?? status;
}
