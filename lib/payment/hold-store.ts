import type { ProviderStatus } from './types';

/**
 * Where `MockPaymentProvider` keeps its holds (KAN-200).
 *
 * The mock used to hold them in a module-level `Map`, which works in a test run
 * and in `next dev` and fails everywhere else: on Vercel each request may be a
 * fresh instance, so the hold placed by `POST /fund` is simply absent by the time
 * `POST /approve` looks for it. The provider then threw `INVALID_REFERENCE`, the
 * ledger rolled the transaction back, and the brand read
 * "Payment failed — please try again." forever — the failure Nate hit walking the
 * loop on 2026-08-20. Nothing was wrong with the money math; the processor had
 * amnesia.
 *
 * So the storage moves behind this seam and the Postgres implementation becomes
 * the default. Two things about the shape are deliberate:
 *
 * **It is dumb on purpose.** No `draw(ref, amount)`, no compare-and-set — just
 * read a record and write it back. An atomic primitive would have to be
 * implemented twice, differently, and the in-memory version could then only
 * approximate the real one; every existing test in
 * `__tests__/mock-provider.test.ts` would be proving something subtly other than
 * what production does. Atomicity is not this layer's to provide anyway: every
 * caller in `lib/payment/ledger.ts` already runs inside a serializable
 * transaction holding the deal's or campaign's row lock (`lockDeal`,
 * `lockCampaign`), so two requests cannot reach the same hold concurrently.
 *
 * **`get` returns a copy, in both implementations.** The `Map` version used to
 * hand back a live reference, so `record.amount -= amount` persisted with no
 * write. Postgres cannot do that, and a seam whose two sides disagree about
 * whether mutation is enough would let a missing `put` pass the unit suite and
 * lose money in production. Copying forces the write to be explicit.
 */
export interface HoldStore {
  /** The hold at `providerRef`, or null if there is none. Never a live reference. */
  get(providerRef: string): Promise<HoldRecord | null>;

  /** Create or overwrite the hold at `providerRef`. */
  put(providerRef: string, record: HoldRecord): Promise<void>;

  /** Drop every hold. Test and seed affordance; no production caller. */
  clear(): Promise<void>;
}

/**
 * One hold, as the provider sees it.
 *
 * `amount` is what is **left** to draw, not what was originally held: both
 * `capturePayout` and `captureCommission` subtract from it and the hold reaches
 * `captured` when it hits zero (invariant 13 — between them the two legs drain
 * it). The Postgres column is named `amount_remaining` for that reason; this
 * field keeps the shorter name because `ProviderStatus.amount` already reports it
 * under that name across the provider contract.
 */
export interface HoldRecord {
  amount: number;
  state: ProviderStatus['state'];
  createdAt: string;
  updatedAt: string;
}

/**
 * The original behaviour, kept as the constructor default.
 *
 * Every test that builds a bare `new MockPaymentProvider()` gets this, so the
 * unit suite stays a pure in-process exercise of the provider's rules with no
 * database. It is also the honest choice for a single-process test: persisting
 * holds would make each test's leftovers the next one's starting state.
 */
export class InMemoryHoldStore implements HoldStore {
  private holds = new Map<string, HoldRecord>();

  async get(providerRef: string): Promise<HoldRecord | null> {
    const record = this.holds.get(providerRef);
    // A copy, not the stored object — see the interface docstring.
    return record ? { ...record } : null;
  }

  async put(providerRef: string, record: HoldRecord): Promise<void> {
    this.holds.set(providerRef, { ...record });
  }

  async clear(): Promise<void> {
    this.holds.clear();
  }
}
