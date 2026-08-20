import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { providerHold } from '@/db/schema';
import type { HoldRecord, HoldStore } from './hold-store';

/**
 * The `HoldStore` that survives a cold start (KAN-200).
 *
 * Split from `hold-store.ts` so the interface and `InMemoryHoldStore` stay free
 * of any `db` import: `__tests__/mock-provider.test.ts` and every other unit test
 * construct a bare `new MockPaymentProvider()` and must not pull `pg` — and by
 * extension a `DATABASE_URL` — in through the door. Only `getPaymentProvider()`
 * imports this file.
 *
 * **On its own connection, not a caller's transaction.** Every call here runs
 * against the shared pool, so a hold write commits independently of the deal
 * transaction that triggered it. That is not an oversight — it is the behaviour
 * of a real processor, which is a separate system whose state does not roll back
 * when ours does. The KAN-40 spike's §5 recovery reasoning already assumes it:
 * a transaction that rolls back after the provider succeeded leaves a hold the
 * processor knows about and our ledger does not, and the answer is reconciliation,
 * not a shared transaction. Passing `tx` in here would make the mock a *less*
 * faithful stand-in than it is today.
 *
 * Which means there is no new failure mode versus the in-memory version: the
 * pre-KAN-200 provider also kept holds outside our transaction, it just kept them
 * somewhere that evaporated.
 */
export class PgHoldStore implements HoldStore {
  async get(providerRef: string): Promise<HoldRecord | null> {
    const rows = await db
      .select({
        amountRemaining: providerHold.amountRemaining,
        state: providerHold.state,
        createdAt: providerHold.createdAt,
        updatedAt: providerHold.updatedAt,
      })
      .from(providerHold)
      .where(eq(providerHold.providerRef, providerRef))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // `HoldRecord` carries ISO strings because that is what the provider contract
    // reports (`ProviderStatus.updatedAt`); the column is `timestamptz` because
    // invariant 11 says so. One conversion, in one place, rather than a `text`
    // column that cannot be compared or indexed as a time.
    return {
      amount: row.amountRemaining,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async put(providerRef: string, record: HoldRecord): Promise<void> {
    const values = {
      providerRef,
      amountRemaining: record.amount,
      state: record.state,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };

    // An upsert rather than insert-or-update, because `put` is the seam's only
    // write and both of the provider's uses reach it: `hold` creates, and every
    // capture or release rewrites. Splitting them would put the decision in the
    // provider, where it would have to be made identically twice.
    await db
      .insert(providerHold)
      .values(values)
      .onConflictDoUpdate({
        target: providerHold.providerRef,
        set: {
          amountRemaining: values.amountRemaining,
          state: values.state,
          updatedAt: values.updatedAt,
        },
      });
  }

  async clear(): Promise<void> {
    await db.delete(providerHold);
  }
}
