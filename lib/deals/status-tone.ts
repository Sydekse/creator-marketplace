import type { ChipTone } from '@/components/ui/chip';
import type { DealStatus } from '@/db/schema';

/**
 * Deal status → chip tone (design doc §3.3, §10.3). One mapping for every
 * screen that renders a deal status as a chip, so a status cannot read amber
 * on the creator's inbox and gray on the brand's campaign. The vocabulary:
 * teal/success for good or active states, amber for waiting, gray for
 * terminal states that are neither good nor bad.
 *
 * `satisfies Record<DealStatus, ChipTone>` mirrors the exhaustiveness guard
 * in `lib/deals/groups.ts`: a tenth status added to the union is a compile
 * error here rather than a chip that silently falls back to gray.
 */
export const dealStatusTone: Record<DealStatus, ChipTone> = {
  // Waiting on the creator to act.
  pending: 'amber',
  // Committed — the creator is working, money is on the way.
  accepted: 'teal',
  declined: 'gray',
  expired: 'gray',
  // Money held in escrow — the good state that makes work worth starting.
  funded: 'teal',
  // Waiting on the brand's review.
  delivered: 'amber',
  // Waiting on the creator to resubmit.
  revision_requested: 'amber',
  // Terminal good.
  completed: 'success',
  refunded: 'gray',
};
