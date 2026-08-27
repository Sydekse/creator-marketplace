/**
 * Happy-path deal progress, for the icon rail on deal pages.
 *
 * History is still the audit trail. This is only how far along the usual
 * offer → accept → fund → deliver → complete walk the deal has reached.
 * Off-path statuses (declined, expired, refunded) sit beside that walk
 * rather than rewriting it.
 */

export const DEAL_PROGRESS_STEPS = [
  'pending',
  'accepted',
  'funded',
  'delivered',
  'completed',
] as const;

export type DealProgressStep = (typeof DEAL_PROGRESS_STEPS)[number];

/** Short rail labels — the full `labelForStatus` strings wrap on a phone. */
export const DEAL_PROGRESS_SHORT_LABEL: Record<DealProgressStep, string> = {
  pending: 'Sent',
  accepted: 'Accepted',
  funded: 'Funded',
  delivered: 'Submitted',
  completed: 'Done',
};

export type DealProgressState = 'done' | 'current' | 'upcoming' | 'blocked';

export interface DealProgressNode {
  step: DealProgressStep;
  state: DealProgressState;
}

const STEP_INDEX: Record<string, number> = {
  pending: 0,
  accepted: 1,
  funded: 2,
  delivered: 3,
  revision_requested: 3,
  completed: 4,
};

const BLOCKED_STATUSES = new Set(['declined', 'expired', 'refunded']);

export function isBlockedDealStatus(status: string): boolean {
  return BLOCKED_STATUSES.has(status);
}

function highestReached(
  current: string,
  events: ReadonlyArray<{ toStatus: string }>
): number {
  let max = -1;
  for (const event of events) {
    const index = STEP_INDEX[event.toStatus];
    if (index !== undefined && index > max) max = index;
  }
  const currentIndex = STEP_INDEX[current];
  if (currentIndex !== undefined && currentIndex > max) max = currentIndex;
  return max;
}

export function dealProgress(
  current: string,
  events: ReadonlyArray<{ toStatus: string }> = []
): DealProgressNode[] {
  const reached = highestReached(current, events);
  const blocked = isBlockedDealStatus(current);

  return DEAL_PROGRESS_STEPS.map((step, index) => {
    if (blocked) {
      if (index <= reached) return { step, state: 'done' };
      if (index === reached + 1) return { step, state: 'blocked' };
      return { step, state: 'upcoming' };
    }
    if (index < reached) return { step, state: 'done' };
    if (index === reached) return { step, state: 'current' };
    return { step, state: 'upcoming' };
  });
}
