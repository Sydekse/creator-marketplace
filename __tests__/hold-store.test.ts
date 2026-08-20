import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryHoldStore } from '../lib/payment/hold-store';
import { MockPaymentProvider } from '../lib/payment/mock-provider';

/**
 * The storage seam under `MockPaymentProvider` (KAN-200).
 *
 * The bug this exists to prevent is not a rule the provider gets wrong — it is
 * the provider being handed a store that forgets. On Vercel each request may run
 * on a fresh instance, so a hold placed while funding a campaign was simply
 * absent when the brand approved a deliverable against it: `capturePayout` threw
 * `INVALID_REFERENCE`, the ledger transaction rolled back, and the brand read
 * "Payment failed — please try again." with no way past it.
 *
 * So the interesting assertion here is the cross-instance one: a *second*
 * provider, sharing only the store, can finish what the first one started. That
 * is the shape of the real request boundary, and no test in
 * `__tests__/mock-provider.test.ts` could express it while the holds lived in a
 * private field.
 *
 * `PgHoldStore` is not unit-tested here on purpose — a store whose entire job is
 * to talk to Postgres proves nothing against a mocked Postgres. It is covered by
 * `tests/integration/money-paths.test.ts`, which runs the real money paths
 * against a real database.
 */
describe('InMemoryHoldStore', () => {
  it('round-trips a record', async () => {
    const store = new InMemoryHoldStore();
    const record = {
      amount: 5000,
      state: 'held' as const,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };

    await store.put('mock_ref', record);
    expect(await store.get('mock_ref')).toEqual(record);
  });

  it('returns null for a ref it has never seen', async () => {
    const store = new InMemoryHoldStore();
    expect(await store.get('mock_missing')).toBeNull();
  });

  /**
   * The guarantee that keeps the two implementations interchangeable. Postgres
   * physically cannot hand back a live row, so if the in-memory store did, a
   * provider method that mutated its record and forgot to `put` would pass every
   * unit test and lose money in production.
   */
  it('hands back a copy, so mutating it persists nothing', async () => {
    const store = new InMemoryHoldStore();
    await store.put('mock_ref', {
      amount: 5000,
      state: 'held',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    });

    const first = await store.get('mock_ref');
    first!.amount = 1;
    first!.state = 'released';

    expect(await store.get('mock_ref')).toMatchObject({
      amount: 5000,
      state: 'held',
    });
  });

  it('overwrites on put, which is what a draw-down needs', async () => {
    const store = new InMemoryHoldStore();
    const base = {
      state: 'held' as const,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };

    await store.put('mock_ref', { ...base, amount: 5000 });
    await store.put('mock_ref', { ...base, amount: 500 });

    expect(await store.get('mock_ref')).toMatchObject({ amount: 500 });
  });

  it('clear drops everything', async () => {
    const store = new InMemoryHoldStore();
    await store.put('mock_a', {
      amount: 1,
      state: 'held',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    });

    await store.clear();
    expect(await store.get('mock_a')).toBeNull();
  });
});

describe('MockPaymentProvider over a shared store', () => {
  it('lets a second instance capture a hold the first one placed', async () => {
    const store = new InMemoryHoldStore();
    const funding = new MockPaymentProvider(store);
    const approval = new MockPaymentProvider(store);

    const hold = await funding.hold(10_000, 'fund-key');

    // The instance that placed the hold is gone as far as `approval` knows —
    // exactly the situation two serverless invocations are in. Before KAN-200
    // this threw `INVALID_REFERENCE`.
    const payout = await approval.capturePayout(
      8_500,
      'creator_abc',
      hold.providerRef,
      'payout-key'
    );
    expect(payout.status).toBe('captured');

    // Both legs, per invariant 13 — and the commission leg drains the hold, so
    // the state a *third* instance reads is `captured`.
    await approval.captureCommission(1_500, hold.providerRef, 'commission-key');
    expect(
      await new MockPaymentProvider(store).getStatus(hold.providerRef)
    ).toMatchObject({ state: 'captured', amount: 0 });
  });

  it('lets a second instance release a hold the first one placed', async () => {
    const store = new InMemoryHoldStore();
    const hold = await new MockPaymentProvider(store).hold(4_000, 'fund-key');

    const released = await new MockPaymentProvider(store).releaseHold(
      hold.providerRef,
      'release-key'
    );
    expect(released.status).toBe('released');
  });

  /**
   * Idempotency keys deliberately do *not* cross instances — see the constructor
   * docstring. Every caller in `lib/payment/ledger.ts` mints its key with
   * `crypto.randomUUID()` inside the call, so a key is only ever replayed within
   * one request's own retry loop. This asserts the boundary is where we think it
   * is: a fresh instance re-executes rather than returning a cached result, which
   * is why the *hold* is the thing that had to become durable and the key was not.
   */
  it('does not share idempotency keys between instances', async () => {
    const store = new InMemoryHoldStore();
    const first = await new MockPaymentProvider(store).hold(1_000, 'same-key');
    const second = await new MockPaymentProvider(store).hold(1_000, 'same-key');

    expect(second.providerRef).not.toBe(first.providerRef);
  });
});

describe('payment module wiring', () => {
  /**
   * A source guard, because the alternative is a DOM-free assertion that cannot
   * exist: `getPaymentProvider` builds a `PgHoldStore`, so calling it here would
   * need a database. What can be proven cheaply is that the production factory
   * has not quietly reverted to the in-memory default — which is the entire
   * defect, and it would leave every unit test in this repo green.
   */
  it('getPaymentProvider constructs the provider with the Postgres store', () => {
    const source = readFileSync(
      join(__dirname, '..', 'lib', 'payment', 'index.ts'),
      'utf8'
    );
    expect(source).toContain('new MockPaymentProvider(new PgHoldStore())');
    expect(source).not.toMatch(/new MockPaymentProvider\(\)/);
  });

  /**
   * The split that keeps the unit suite database-free. If `hold-store.ts` ever
   * imports `@/db`, every test that builds a bare provider starts needing a
   * `DATABASE_URL`.
   */
  it('keeps the in-memory store free of any database import', () => {
    const source = readFileSync(
      join(__dirname, '..', 'lib', 'payment', 'hold-store.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/from '@?\/?\.*db/);
    expect(source).not.toContain('drizzle');
  });
});
