import type { DealStatus } from '@/db/schema';

/**
 * How a creator's dashboard groups deals (KAN-25, AC-2).
 *
 * AC-2 names four groups — pending offers, accepted/in-progress, awaiting
 * approval, completed — and the deal state machine has nine statuses. The
 * machine wins: every status has to render somewhere, so a fifth group holds
 * the three terminal states the AC does not name. Without it, a deal that was
 * declined or expired would silently vanish from the only screen a creator has
 * to see it on.
 *
 * Pure domain vocabulary, deliberately with no database imports. The deal inbox
 * (KAN-39) is two waves out and will group the same nine statuses, and the
 * moment this mapping is imported from `lib/deals/` rather than re-derived per
 * screen, a new status cannot fail to appear in one of them.
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
