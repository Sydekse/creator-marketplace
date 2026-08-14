import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db as defaultDb } from '@/db';
import { brandProfile, campaign, deal } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { transitionDeal, TransitionError } from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import type { Job, JobRunOutput } from '@/lib/scheduler/harness';

/**
 * The offer-expiry sweep (KAN-38, US-006, AC-018 expiry branch, Tech Spec §5).
 *
 * The third and last way a pending offer ends. `accept-offer.ts` and
 * `decline-offer.ts` are driven by the creator; this one is driven by nobody,
 * which is the whole point — a brand's budget must not stay committed because a
 * creator never answered.
 *
 * **Structurally the mirror of `decline-offer.ts`, and for the same reasons it
 * is short.** There is no ledger call (money first moves at funding, so a
 * `pending` deal has no `hold` to reverse — `REFUNDABLE_FROM` excludes it) and
 * **no budget write at all**: available budget is derived in
 * `lib/campaigns/budget.ts`, where `expired` is `false` in `COMMITS_BUDGET`, so
 * flipping the status *is* the release. The released amount equals `total_price`
 * by construction, because it is the same column the sum stops counting. AC-018
 * asks that the release and the status change apply together; they cannot come
 * apart, because there is only one write.
 *
 * **What is different from the creator-driven paths, and why.**
 *
 * - **No `guard()`.** Every other deal action owes two layers of NFR-005, but
 *   there is no session here and no creator to own the row. The authentication
 *   boundary is the cron secret on `/api/cron`, one layer out
 *   (`verifyCronSecret`, KAN-56 AC-002), and `authz-coverage.test.ts` exempts
 *   that route on exactly that basis. This module is not exported to any
 *   request-scoped caller, which is what keeps that from being a hole: the sweep
 *   is reachable from the scheduler and from tests, and from nowhere else.
 * - **`actorId` is null** (AC-3). The schema's convention for "the system did
 *   this", and the reason `toHistoryEvent` renders a null actor as the system
 *   rather than a blank name.
 * - **One transaction per deal, not one for the sweep.** AC-5 requires that one
 *   failing deal not abort the others, and a shared transaction would roll back
 *   every expiry when the last one deadlocked. The unit of atomicity is the deal
 *   — which is also the unit AC-018 describes.
 *
 * **Idempotency (AC-2) is inherited, not implemented.** A second run inside the
 * same window re-selects nothing, because the first run's rows are no longer
 * `pending`. If a duplicate delivery races the first run, the loser blocks on the
 * `FOR UPDATE` in `transitionDeal`, then reads `expired` and is refused by
 * `LEGAL_TRANSITIONS` — no second `deal_event`, and no second notification,
 * because the notify call sits after the transition inside the same transaction.
 * That refusal is a **skip, not a failure**: it is the sweep working, so it must
 * not be logged as an error or counted against the run.
 *
 * **AC-7, the creator who accepts moments before expiry, falls out for free.**
 * Both paths take the same row lock. Whoever gets it first writes their status;
 * the other then reads it and is refused. `accepted` is not in
 * `LEGAL_TRANSITIONS.pending`'s inbound edges for us to overwrite, so a late
 * sweep cannot expire an accepted deal, and a late acceptance is answered with
 * `OFFER_EXPIRED` by `getErrorCodeForInvalidTransition`. Neither needs to know
 * the other exists.
 */

/** Recorded on the `deal_event`, so the history says what happened in words. */
export const EXPIRE_EVENT_REASON = 'Offer expired before the creator responded';

/** The scheduler's name for this job, and the label its log lines carry. */
export const EXPIRE_OFFERS_JOB_NAME = 'expire-offers';

/**
 * How many lapsed offers one run will take.
 *
 * A bound rather than the whole backlog, because the run is answerable to the
 * harness's 290s watchdog and a first run over a long-neglected table is
 * unbounded work. Reconciliation makes the remainder cheap to leave: whatever is
 * missed is still lapsed at the next run and gets swept then. Chosen well under
 * what fits the window rather than tuned — the sweep is nine writes per deal at
 * most, and the failure mode of too small is a delay, while too large is a
 * timeout mid-batch.
 */
export const EXPIRE_BATCH_LIMIT = 200;

/** What the sweep needs about a lapsed deal, its campaign, and the brand. */
export interface ExpiringDealRow {
  id: string;
  /** The amount the expiry releases. Integer santim (invariant 4). */
  totalPrice: number;
  campaignId: string;
  campaignName: string;
  /**
   * `user.id`, not `brand_profile.id` — the two-hop rule from `lib/authz.ts`.
   *
   * Business rows reference profile ids and notifications address a user, so
   * `campaign.brand_id` is walked through `brand_profile.user_id` before
   * anything is sent. Passing the profile id here writes a notification row
   * nobody can read.
   */
  brandUserId: string;
}

/** What one deal's sweep did, which is what makes the counters honest. */
export type ExpireOutcome = 'expired' | 'skipped' | 'failed';

export interface ExpireOffersDeps {
  /**
   * Ids of deals whose offer window has shut, oldest deadline first.
   *
   * Outside any transaction and deliberately only ids: holding a lock across
   * the whole batch would serialise every creator's accept for the duration of
   * the run. Each deal is re-read under its own lock before anything is judged,
   * so this list is a work queue, not a source of truth — a row that stops being
   * `pending` between here and there is refused there.
   */
  selectLapsed: (limit: number, now: Date) => Promise<string[]>;
  /**
   * Loads one deal under a `FOR UPDATE` lock.
   *
   * Unscoped by creator, unlike the accept and decline loaders: there is no
   * acting creator to scope to. The lock is the only thing this needs to do,
   * and it is what AC-7 rests on.
   */
  loadDeal: (tx: Tx, dealId: string) => Promise<ExpiringDealRow | null>;
  transition: (tx: Tx, dealId: string) => Promise<unknown>;
  /** One transaction per deal — see the note on atomicity above. */
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
  log: Pick<Console, 'error'>;
  now: () => Date;
}

/**
 * The sweep predicate, as a `where` clause (AC-1).
 *
 * Exported so the suite can assert its three parts without a live Postgres,
 * because each one is a way for the sweep to be quietly wrong:
 *
 * - `status = 'pending'` — the guard AC-2 rests on, and the reason a second run
 *   re-selects nothing.
 * - `offer_expires_at < now` — run-time-relative, never midnight arithmetic.
 *   Hobby cron fires anywhere inside the scheduled hour (±59 min), so a
 *   predicate written against the schedule rather than the clock would expire
 *   offers early on an unlucky invocation.
 * - `offer_expires_at IS NOT NULL` — redundant against `lt`, which no NULL row
 *   satisfies, and kept because it says out loud that a null-window offer never
 *   expires. The column is nullable, `confirm-campaign.ts` always populates it,
 *   and F27 records that an offer issued without one would hold budget forever.
 *   The explicit clause is where a reader learns that, and it keeps the index on
 *   `(status, offer_expires_at)` unambiguous about which rows it serves.
 */
export function buildLapsedOffersWhere(now: Date): SQL {
  return and(
    eq(deal.status, 'pending'),
    isNotNull(deal.offerExpiresAt),
    lt(deal.offerExpiresAt, now)
  ) as SQL;
}

const defaultDeps: ExpireOffersDeps = {
  selectLapsed: async (limit, now) => {
    const rows = await defaultDb
      .select({ id: deal.id })
      .from(deal)
      .where(buildLapsedOffersWhere(now))
      // Oldest deadline first, so a backlog larger than one batch drains in the
      // order the offers actually lapsed rather than in whatever order the scan
      // returned. The bounded run makes the ordering matter.
      .orderBy(asc(deal.offerExpiresAt))
      .limit(limit);

    return rows.map((row) => row.id);
  },
  loadDeal: async (tx, dealId) => {
    const [row] = await tx
      .select({
        id: deal.id,
        totalPrice: deal.totalPrice,
        campaignId: deal.campaignId,
        campaignName: campaign.name,
        brandUserId: brandProfile.userId,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .where(eq(deal.id, dealId))
      // Locks the deal row only. Both joins are inner on `not null` foreign
      // keys, so neither can miss; locking them would serialise unrelated work
      // on the same campaign — including the other deals in this very batch.
      .for('update', { of: deal })
      .limit(1);

    return row ?? null;
  },
  // Delegated to the state machine, which owns every `deal_event` write and
  // re-reads the row under its own lock before judging legality (invariant 6).
  // `null` actor: the system acted, not a person (AC-3).
  transition: (tx, dealId) =>
    transitionDeal(tx, dealId, 'expired', null, {
      reason: EXPIRE_EVENT_REASON,
    }),
  run: (fn) => withNotifications(fn),
  log: console,
  now: () => new Date(),
};

/**
 * Expires one lapsed offer and notifies the brand, in one transaction.
 *
 * Returns an outcome rather than throwing, so the caller's counters can tell
 * the three cases apart. `skipped` is not a degraded `expired`: it is the
 * idempotency guard firing, which is the sweep behaving correctly.
 */
async function expireOne(
  dealId: string,
  deps: ExpireOffersDeps
): Promise<ExpireOutcome> {
  try {
    return await deps.run(async (tx, notify) => {
      const row = await deps.loadDeal(tx, dealId);
      if (!row) {
        // Selected a moment ago and gone now. Nothing is wrong — the row cannot
        // be deleted by anything we ship — so this is a skip, not a failure.
        return 'skipped';
      }

      try {
        await deps.transition(tx, dealId);
      } catch (error) {
        if (error instanceof TransitionError) {
          // Someone got there first: the creator accepted or declined between
          // the select and the lock, or this is a duplicate run. Either way the
          // offer is already resolved and there is nothing to release. AC-2.
          return 'skipped';
        }
        throw error;
      }

      // "The brand is notified" (AC-018). Inside the transaction, so a rollback
      // takes the row with it and the email is never queued; `withNotifications`
      // flushes only after the commit.
      await notify(row.brandUserId, 'offer_expired', {
        dealId,
        campaignTitle: row.campaignName,
        releasedAmount: row.totalPrice,
      });

      return 'expired';
    });
  } catch (error) {
    // AC-5: one failing deal does not abort the sweep. Logged with the deal id
    // (AC-6/AC-7 of KAN-56 — enough context to identify the affected deal) and
    // no row content, so nothing here can carry PII (NFR-010). Retried by the
    // next run for free: the deal is still `pending` and still lapsed.
    deps.log.error(
      JSON.stringify({
        level: 'error',
        event: 'expire_offers.deal_failed',
        job: EXPIRE_OFFERS_JOB_NAME,
        dealId,
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return 'failed';
  }
}

/**
 * Sweeps every offer whose window has shut (AC-1).
 *
 * `examined` is what the predicate matched, `acted` the number actually moved to
 * `expired` — deliberately not equal when a deal was resolved underneath us, so
 * an operator reading the log can see contention rather than having it rounded
 * away.
 *
 * Sequential rather than concurrent, because the pool is `max: 5` per instance
 * and a batch of 200 opening a transaction each would exhaust it and turn the
 * sweep's own connections into the failure. The work is small and the window is
 * 290 seconds.
 */
export async function expireOffers(
  deps: ExpireOffersDeps = defaultDeps,
  signal?: AbortSignal
): Promise<JobRunOutput> {
  const lapsed = await deps.selectLapsed(EXPIRE_BATCH_LIMIT, deps.now());

  let acted = 0;
  let examined = 0;

  for (const dealId of lapsed) {
    // Checked between deals rather than mid-deal: a transaction is not
    // interruptible without leaving the release half-applied, so the signal is
    // honoured at the only boundary where stopping is safe. Whatever is left is
    // still lapsed at the next run.
    if (signal?.aborted) break;

    examined += 1;
    if ((await expireOne(dealId, deps)) === 'expired') {
      acted += 1;
    }
  }

  return { examined, acted };
}

/**
 * The scheduler's registration for this sweep (KAN-56 AC-003).
 *
 * A `Job`, so the harness owns the timing, the counters, the per-job isolation
 * and the log line. This module owns only what expiring an offer means.
 */
export const expireOffersJob: Job = {
  name: EXPIRE_OFFERS_JOB_NAME,
  run: (signal) => expireOffers(defaultDeps, signal),
};
