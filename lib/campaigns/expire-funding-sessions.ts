import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { fundingSession } from '@/db/schema';
import type { Job, JobRunOutput } from '@/lib/scheduler/harness';

/**
 * Sweeps funding sessions abandoned at checkout (KAN-70).
 *
 * A session left `initialized` for a day is a checkout nobody is coming back
 * to — expiring it clears the campaign page's "payment in progress" banner
 * and, via the partial unique index, lets a fresh session open. 24 hours is
 * generous on purpose: Chapa's own retry window for a failed charge is
 * shorter, and expiring early would kill a checkout someone is still sitting
 * on.
 *
 * Reconciliation-based per the KAN-38 contract: one conditional UPDATE whose
 * WHERE re-checks state, so duplicate runs and races with settlement are
 * no-ops — a session paid at hour 23 settles (`consumed`) and leaves the
 * sweep's `initialized` filter before the sweep sees it. And if the sweep
 * wins a photo-finish anyway, `settle-funding.ts` deliberately claims
 * `expired` sessions too: paid money is honoured no matter which write
 * landed first.
 */
export const FUNDING_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ExpireFundingSessionsDeps {
  expireStale: (cutoff: Date) => Promise<number>;
  now: () => Date;
}

const defaultDeps: ExpireFundingSessionsDeps = {
  expireStale: async (cutoff) => {
    const rows = await db
      .update(fundingSession)
      .set({ status: 'expired' })
      .where(
        and(
          eq(fundingSession.status, 'initialized'),
          lt(fundingSession.createdAt, cutoff)
        )
      )
      .returning({ id: fundingSession.id });
    return rows.length;
  },
  now: () => new Date(),
};

export async function expireFundingSessions(
  deps: ExpireFundingSessionsDeps = defaultDeps
): Promise<JobRunOutput> {
  const cutoff = new Date(deps.now().getTime() - FUNDING_SESSION_TTL_MS);
  const acted = await deps.expireStale(cutoff);
  // One statement examines and acts in the same breath, so the two counts
  // are the same number: rows that were both stale and still open.
  return { examined: acted, acted };
}

export const expireFundingSessionsJob: Job = {
  name: 'expire-funding-sessions',
  run: () => expireFundingSessions(),
};
