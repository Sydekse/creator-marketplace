import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/db';
import * as schema from '@/db/schema';
import { dispatchWithRetry } from './dispatch';
import type { DispatchLog } from './dispatch';
import { providerFromEnv } from './providers';
import { renderNotification } from './templates';
import type {
  EmailMessage,
  EmailProvider,
  NotificationInput,
  NotificationPayloadMap,
  NotificationType,
} from './types';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The notification service (KAN-54, Tech Spec §5).
 *
 * Two acceptance criteria pull in opposite directions and together determine
 * the whole shape of this module:
 *
 *   AC-3  a failed email must never roll back the domain transaction
 *   AC-4  a failed domain transaction must never leave a sent email behind
 *
 * Satisfying only the first is easy and wrong — send inside the transaction,
 * swallow errors, and a rolled-back deal has already told the creator they were
 * paid. Satisfying only the second is also easy and wrong — send after commit
 * with no error handling, and a Resend outage takes down approvals.
 *
 * Both hold here because the row and the email are separated in time:
 *
 *   - the **row** is written inside the caller's transaction, so it rolls back
 *     with everything else;
 *   - the **email** is queued, and only dispatched once the transaction has
 *     committed — with its own bounded retry, and errors that go to the log
 *     rather than to the caller.
 *
 * `withNotifications` is what makes that structural instead of a convention. A
 * call site cannot send early, because the outbox it writes to is not flushed
 * until the transaction it wraps has returned.
 *
 * **Known limit.** The queue is in memory, so a process that dies between
 * commit and flush loses the email — the in-app row survives, which is why the
 * row is the source of truth and the email is the courtesy copy. Making
 * delivery durable means an outbox table drained by cron; that is a follow-up,
 * not this ticket (the 13-table schema is fixed, and KAN-55/56 own the cron).
 *
 * **Delivery is still recorded.** A successful dispatch stamps
 * `notification.delivered_at` (a post-commit write, so it can never roll back
 * a domain transaction — it is bookkeeping about mail, not part of the money
 * path). The stamp's consumer is the metric-reminder guard (KAN-57 F3): only
 * a *delivered* reminder suppresses the next one, so a dispatch failure is
 * retried on the next run instead of being believed delivered. A crash between
 * commit and stamp leaves the row undelivered and the next run re-reminds —
 * the mirror of the crash-loss above, and the safe direction: it may send one
 * mail twice, never believe one was sent.
 */

/** The single entry point named by AC-1, in both its bound and unbound forms. */
export type Notify = <K extends NotificationType>(
  userId: string,
  type: K,
  payload: NotificationPayloadMap[K]
) => Promise<void>;

export interface NotifyDeps {
  db: Db;
  provider: EmailProvider;
  render: (input: NotificationInput) => Promise<EmailMessage>;
  log: DispatchLog;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Built lazily, per call, rather than at module load.
 *
 * `providerFromEnv` reads the environment, and a module-level constant would
 * freeze whatever the environment looked like at import time — which in tests
 * and in `next build` is not the environment the code will run in.
 */
function defaultDeps(): NotifyDeps {
  return {
    db: defaultDb,
    provider: providerFromEnv(),
    render: renderNotification,
    log: console,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** A queued email, waiting for its transaction to commit. */
interface Pending {
  /** The inserted row — what gets stamped `deliveredAt` once dispatch succeeds. */
  rowId: string;
  userId: string;
  input: NotificationInput;
}

/**
 * Run `fn` in a transaction, then deliver whatever it notified.
 *
 * Use this for every notification raised by a state transition — which is all
 * of them that touch money or deal status. The `notify` handed to `fn` writes
 * its row through `tx`, so the notification is as atomic as the transition that
 * caused it (invariant 6 applies the same reasoning to `deal_event`).
 *
 * Dispatch happens strictly after `db.transaction` resolves. If it rejects, the
 * queue is dropped untouched: no rows (rolled back) and no emails (never sent).
 */
export async function withNotifications<T>(
  fn: (tx: Tx, notify: Notify) => Promise<T>,
  deps: NotifyDeps = defaultDeps()
): Promise<T> {
  const pending: Pending[] = [];

  const result = await deps.db.transaction(async (tx) => {
    // Built here, so the notify handed to `fn` closes over the live
    // transaction. There is no form of it that exists without one, and so no
    // way for a caller to get hold of one that writes outside the transaction.
    const scoped: Notify = async (userId, type, payload) => {
      const rowId = await insertRow(deps.db, userId, type, payload, tx);
      pending.push({
        rowId,
        userId,
        input: { type, payload } as NotificationInput,
      });
    };

    return fn(tx, scoped);
  });

  // Past this line the transaction has committed. Only now can an email go out,
  // and from here nothing it does can affect the result already returned.
  await flush(pending, deps);

  return result;
}

/**
 * Notify outside any transaction (AC-1).
 *
 * For the call sites with no domain transaction to belong to — where there is
 * no rollback for an email to be inconsistent with. Anything that changes deal
 * or campaign state should use `withNotifications` instead.
 */
export const notify: Notify = async (userId, type, payload) => {
  const deps = defaultDeps();
  await notifyWith(deps, userId, type, payload);
};

/** `notify` with its dependencies supplied — the form the tests drive. */
export async function notifyWith<K extends NotificationType>(
  deps: NotifyDeps,
  userId: string,
  type: K,
  payload: NotificationPayloadMap[K]
): Promise<void> {
  const rowId = await insertRow(deps.db, userId, type, payload);
  await flush(
    [{ rowId, userId, input: { type, payload } as NotificationInput }],
    deps
  );
}

async function insertRow<K extends NotificationType>(
  db: Db,
  userId: string,
  type: K,
  payload: NotificationPayloadMap[K],
  tx?: Tx
): Promise<string> {
  const [row] = await (tx ?? db)
    .insert(schema.notification)
    .values({
      userId,
      type,
      payload,
    })
    .returning({ id: schema.notification.id });
  return row.id;
}

/**
 * Deliver every queued email, then return — whatever happened.
 *
 * Failures are logged inside `dispatchWithRetry` and swallowed here, because
 * this runs after the domain transaction has already committed and its caller
 * has already succeeded. Throwing now could only turn a completed deal into an
 * error response for an email problem (AC-3).
 *
 * Sends run sequentially. Notification batches are small (a campaign's deals),
 * and a burst of parallel requests is what makes a rate limit worse.
 */
async function flush(pending: Pending[], deps: NotifyDeps): Promise<void> {
  for (const item of pending) {
    try {
      const recipient = await recipientFor(deps.db, item.userId);
      if (!recipient) {
        // The in-app row still exists — the user will see it on next login.
        deps.log.error(
          `[email] no recipient for user=${item.userId} type=${item.input.type}`
        );
        continue;
      }

      const message = await deps.render(item.input);
      const outcome = await dispatchWithRetry(recipient, message, {
        provider: deps.provider,
        sleep: deps.sleep,
        log: deps.log,
      });

      // Only a delivered mail gets the stamp. A failure (or a crash before
      // this line) leaves `delivered_at` null, which is the metric-reminder
      // guard's signal to try again next run — and for every other type it is
      // inert bookkeeping. This write is post-commit and never throws to the
      // caller: its failure degrades to "undelivered", the safe direction.
      if (outcome.ok) {
        try {
          await deps.db
            .update(schema.notification)
            .set({ deliveredAt: new Date() })
            .where(eq(schema.notification.id, item.rowId));
        } catch (error) {
          deps.log.error(
            `[email] delivered stamp failed for user=${item.userId} type=${item.input.type} reason=${
              error instanceof Error
                ? JSON.stringify(error.message)
                : '"unknown"'
            }`
          );
        }
      }
    } catch (error) {
      // Reached only if rendering or the lookup itself throws; dispatch handles
      // its own. Still swallowed — same reason.
      deps.log.error(
        `[email] dispatch failed for user=${item.userId} type=${item.input.type} reason=${
          error instanceof Error ? JSON.stringify(error.message) : '"unknown"'
        }`
      );
    }
  }
}

async function recipientFor(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  return rows[0]?.email ?? null;
}
