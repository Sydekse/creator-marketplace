# KAN-40 Spike: Escrow Ledger Design + PaymentProvider Contract

**Author:** Dev B  
**Date:** 2026-07-30  
**Status:** Decision Record  
**Drives:** KAN-41 (`PaymentProvider` interface), KAN-42 (escrow ledger service)

---

## 1. Objective

Design the escrow-ledger service and the `PaymentProvider` abstraction that sits
between the marketplace and an external PSP. The output is this written decision
so KAN-41 and KAN-42 share a single source of truth.

---

## 2. Data Model — Confirmed

The existing `ledger_entry` table in `db/schema.ts:300` supports every required
operation with no changes needed.

| Field           | Role                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `campaign_id`   | Groups entries — campaign is the escrow container                       |
| `deal_id`       | Nullable; links `hold`/`release_payout`/`commission` to a specific deal |
| `entry_type`    | `hold`, `release_payout`, `commission`, `refund`                        |
| `amount`        | Signed integer (positive = into escrow, negative = out)                 |
| `balance_after` | Campaign running balance after this entry                               |
| `provider_ref`  | External PSP transaction ID (nullable)                                  |

**Decision:** No schema changes needed. The table is append-only per existing
design — rows are never updated or deleted.

---

## 3. Commission Math

### 3.1 Rate source

`deal.commission_rate` is a `numeric(5,2)` snapshot taken at offer-accept time,
stored as a percentage (e.g. `15.00` = 15%). Re-pricing the platform rate never
retroactively changes accepted deals.

### 3.2 Open question Q1

The exact commission % is still unconfirmed. **Recommend default: 15%** (industry
standard for creator marketplaces). The execution plan flags Q1 as needing
business sign-off before KAN-20 (seed data). Until then KAN-42 should accept the
rate as a parameter — do not hardcode it.

### 3.3 Payout formula

```
                   total_price  (deal.total_price)
                 = video_count × deal.unit_price

     creator_payout = total_price × (1 - commission_rate / 100)
   platform_revenue = total_price × (commission_rate / 100)

// All values in ETB santim. Both must sum to total_price exactly.
```

### 3.4 Ledger entries on approval

When a deliverable is approved (KAN-45), the ledger service writes **two entries**
inside one DB transaction:

1. `release_payout` — negative amount (creates creator receivable), `deal_id` set
2. `commission` — negative amount (platform revenue), `deal_id` set

The sum of both = `total_price`. The campaign balance drops by `total_price`.

### 3.5 Refund math

On refund (dispute resolution or decline after funding), the full held amount for
that deal is returned:

```
      refund_amount = deal.total_price  // positive entry type 'refund'
```

One ledger entry: `refund` — positive amount, campaign balance rises.

---

## 4. PaymentProvider Interface

This is the contract that KAN-41 implements and KAN-42 calls. It lives in
`lib/payment/types.ts` (KAN-41 creates this file).

```typescript
// lib/payment/types.ts  —  PaymentProvider contract

export interface PaymentProvider {
  /**
   * Reserve funds against a payment method.
   * Called when a campaign is funded (KAN-43).
   *
   * - amount: ETB santim (integer)
   * - idempotencyKey: caller-generated UUID so the PSP can deduplicate
   *
   * Returns a provider reference string on success.
   * Throws PaymentError on failure (KAN-44).
   */
  hold(amount: number, idempotencyKey: string): Promise<ProviderHoldResult>;

  /**
   * Capture held funds and transfer to the platform's settlement account.
   * Called when a deal is approved (KAN-45).
   *
   * - amount: the exact creator payout (total_price - commission)
   * - holdRef: the providerRef from the corresponding hold()
   *
   * Returns a provider reference string on success.
   */
  capturePayout(
    amount: number,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult>;

  /**
   * Release a hold without transferring funds (i.e. cancellation).
   * Called on deal decline after funding, or dispute refund.
   *
   * - holdRef: the providerRef from the corresponding hold()
   */
  releaseHold(
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderReleaseResult>;

  /**
   * Check the status of a previous operation by provider reference.
   * Used for reconciliation and manual review.
   */
  getStatus(providerRef: string): Promise<ProviderStatus>;
}

// -- Result types ------------------------------------------------------------

export interface ProviderHoldResult {
  providerRef: string;
  status: 'held';
  heldAt: string; // ISO 8601
}

export interface ProviderCaptureResult {
  providerRef: string;
  status: 'captured';
  capturedAt: string;
}

export interface ProviderReleaseResult {
  providerRef: string;
  status: 'released';
  releasedAt: string;
}

export interface ProviderStatus {
  providerRef: string;
  state: 'held' | 'captured' | 'released' | 'failed';
  amount: number;
  updatedAt: string;
  errorMessage?: string;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: PaymentErrorCode
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export type PaymentErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_REFERENCE'
  | 'DUPLICATE_IDEMPOTENCY'
  | 'UNKNOWN';
```

### 4.1 Why three separate methods, not one `transfer`

The escrow pattern demands a two-phase flow:

1. **hold** — reserves funds at campaign funding time (KAN-43)
2. **capturePayout** / **releaseHold** — days or weeks later after work is done

A single `transfer` call cannot model this delay. The three-method design maps
directly to the deal state machine's funded→completed→payout lifecycle.

### 4.2 Idempotency

Every mutating method accepts an `idempotencyKey` (UUID V4, generated by the
caller). The `PaymentProvider` impl MUST use this to deduplicate — if the same
key is seen twice, return the original result without re-executing. This lets
the ledger service retry safely on timeout (KAN-44).

### 4.3 MockPaymentProvider

KAN-41 builds a `MockPaymentProvider` that:

- Stores "holds" in an in-memory `Map<providerRef, { amount, status }>`
- Always succeeds (unless explicitly configured to fail for testing)
- Generates provider refs as `mock_${uuid}`
- Respects idempotency keys
- Has a `setFailNext(method: string)` toggle for test scenarios

The mock is **not** a test double — it ships to production so the app is
runnable in preview/staging without real PSP credentials.

---

## 5. Escrow Ledger Service Shape

KAN-42 builds a service in `lib/payment/ledger.ts` that:

```typescript
// lib/payment/ledger.ts  —  Escrow ledger service

export class EscrowLedgerService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly provider: PaymentProvider,
  )

  /**
   * Hold funds for all accepted deals in a confirmed campaign.
   * Called by KAN-43 (brand funds campaign).
   *
   * - Sums total_price of every accepted deal
   * - Calls provider.hold() once for the campaign total
   * - Writes one ledger_entry per deal with type 'hold'
   */
  async holdForCampaign(campaignId: string): Promise<void>

  /**
   * Release payout + commission for one approved deliverable.
   * Called by KAN-45 (approve deliverable).
   *
   * - Calls provider.capturePayout() for the creator net amount
   * - Writes two ledger entries: 'release_payout', 'commission'
   * - Updates deal status to 'completed'
   */
  async payoutForDeal(dealId: string): Promise<void>

  /**
   * Refund a deal's held funds back to the campaign.
   * Called by KAN-37 (decline), KAN-38 (expiry), KAN-51 (dispute refund).
   *
   * - Calls provider.releaseHold()
   * - Writes one ledger entry with type 'refund'
   */
  async refundDeal(dealId: string): Promise<void>
}
```

Each method runs inside a **Drizzle transaction** using a serializable isolation
level. The `balance_after` column is computed in-memory and guarded with an
explicit check (`IF balance_after < 0 THEN ROLLBACK`) inside the transaction.

---

## 6. Key Invariants

| #   | Invariant                                                              | Enforced by                                                                        |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Campaign balance = sum of all `amount` in its `ledger_entry` rows      | `balance_after` + in-transaction guard                                             |
| 2   | Every `release_payout` is paired with a prior `hold` for the same deal | Deal state machine (funded → completed)                                            |
| 3   | Total of `release_payout` + `commission` = `total_price` (that deal)   | In-transaction assertion in KAN-45                                                 |
| 4   | One `hold` entry per deal per campaign — no double-funding             | `ledger_entry` UNIQUE on `(deal_id, 'hold')` (DB constraint) — **needs migration** |
| 5   | `provider_ref` on `hold` entries matches a real PSP hold               | Not nullable after funding — written in same transaction                           |
| 6   | Money is never created or destroyed — ledger sum is zero-sum           | Audit: sum all entries across time = 0                                             |
| 7   | Failed provider calls leave campaign untouched                         | KAN-44: roll back DB changes on `PaymentError`                                     |

**Invariant 4 — recommended migration:** Add a partial unique index on `ledger_entry`:

```sql
CREATE UNIQUE INDEX ledger_entry_deal_hold_unique
  ON ledger_entry (deal_id) WHERE entry_type = 'hold';
```

This prevents a second `hold` for the same deal. Discuss in KAN-42 review.

---

## 7. Edge Cases

### 7.1 Funding failure (KAN-44)

If `provider.hold()` throws `PaymentError`:

- The DB transaction is rolled back — no entries written
- Campaign status stays `confirmed` (not `funded`)
- Brand sees error and can retry
- Idempotency key prevents double-hold if the PSP received it but response was lost

### 7.2 Partial campaign funding

Not in MVP scope. KAN-42 funds the full campaign or nothing (all-or-nothing per
campaign). Partial funding is a future enhancement.

### 7.3 Multi-deal approval order

Deals are paid out independently as each deliverable is approved. The campaign
balance decreases monotonically. If the brand disputes a deal after some have
already been paid out, only the remaining held balance is available for refund.

### 7.4 Commission on refund

No commission is earned on refunded deals. The platform only takes commission on
`release_payout` entries. Refunds return the full `total_price` to the campaign.

### 7.5 Provider goes down

The `PaymentProvider` interface throws `PaymentError` with code
`PROVIDER_UNAVAILABLE`. The caller (KAN-43/KAN-45) returns HTTP 502 and does not
change any state. A retry mechanism is out of scope for MVP (manual retry by the
user is sufficient).

---

## 8. Summary of Decisions

| Decision              | Choice                                                        | Rationale                                             |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Schema change needed? | **No** — `ledger_entry` covers all operations                 | Existing schema matches the escrow pattern            |
| Commission rate       | **15% default**, configurable per-deal via snapshot           | Q1 still open; parameterise in KAN-42                 |
| Provider methods      | `hold()`, `capturePayout()`, `releaseHold()`                  | Two-phase escrow requires funding/approval separation |
| Idempotency           | UUID key passed by caller, enforced by provider               | Enables safe retry on timeout                         |
| Mock ships to prod    | Yes — `MockPaymentProvider` inlined, not test-only            | Preview/staging runs without real PSP                 |
| Invariant 4           | Partial unique index on `(deal_id) WHERE entry_type = 'hold'` | Prevents double-funding a deal                        |
| Funding model         | All-or-nothing per campaign                                   | MVP scope; partial funding is a future enhancement    |

---

## 9. Files KAN-41 Should Create

```
lib/
  payment/
    types.ts          ← PaymentProvider interface + result types + PaymentError
    mock-provider.ts  ← MockPaymentProvider (always-succeed, with failNext toggle)
    index.ts          ← re-exports
```
