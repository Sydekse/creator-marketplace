/**
 * Pricing and commission configuration.
 *
 * PROVISIONAL — the pricing and commission values in this file are placeholders
 * pending Q1 (commission rate and who bears it) and Q2 (tier bands and price per
 * video). Nothing depends on the specific numbers; they exist so the marketplace
 * loop can be built and demoed before the business answers those questions.
 *
 * The two time windows below are a different kind of value: product decisions
 * with no open question behind them, and settled. They live here for the same
 * reason as everything else, not because they are provisional.
 *
 * The point of this module is that there is exactly *one* place to change when
 * they are answered. Do not copy these values into seed scripts, tests, or
 * business logic — import them.
 */

/**
 * Platform commission, as a percentage string matching `deal.commission_rate`
 * (numeric(5, 2) — '15.00' means 15%).
 *
 * A string rather than a number on purpose. Drizzle maps `numeric` to string,
 * and the KAN-40 ledger spike (§3.3) derives payout by subtraction from integer
 * basis points specifically so no float ever enters the money path:
 *
 *     rateBp     = Math.round(Number(commissionRate) * 100)   // '15.00' -> 1500
 *     commission = Math.round((totalPrice * rateBp) / 10_000)
 *     payout     = totalPrice - commission                    // exact, always
 *
 * Keeping the configured value a string means the only float that ever exists
 * is the intermediate inside that first line.
 *
 * 15% is the spike's recommended default (KAN-40 §3.2), still awaiting sign-off
 * on Q1. This value is *not* read at payout time — `deal.commission_rate` is
 * snapshotted onto each deal at offer time, so changing it here never alters a
 * deal that is already in flight.
 */
export const COMMISSION_RATE = '15.00';

/**
 * The tier ladder seeded into `pricing_tier`.
 *
 * `pricePerVideo` is an integer in **ETB santim** (1 ETB = 100 santim,
 * invariant 4). So 150_000 is 1,500 ETB — the figures below are santim, not
 * birr, and are an order-of-magnitude guess at the Ethiopian creator market
 * until Q2 lands.
 *
 * `minEngagement` is a percentage string, matching
 * `pricing_tier.min_engagement` — numeric(5, 2), same reasoning as above.
 *
 * The three names are the ones AC1 asks for. Extra bands (Nano, Mega) are easy
 * to add once Q2 defines them, but each one is another placeholder somebody has
 * to review later, so the seed stays at the three the ticket specifies.
 */
export const PRICING_TIERS = [
  {
    name: 'Micro',
    pricePerVideo: 150_000,
    minFollowers: 10_000,
    minEngagement: '3.00',
  },
  {
    name: 'Mid',
    pricePerVideo: 500_000,
    minFollowers: 50_000,
    minEngagement: '4.00',
  },
  {
    name: 'Macro',
    pricePerVideo: 1_500_000,
    minFollowers: 250_000,
    minEngagement: '5.00',
  },
] as const;

/**
 * How long a `pending` offer stands before the expiry sweep may take it.
 *
 * Neither the PRD nor the tech spec ever gave this a duration — AC-018 names an
 * "offer window" and the column that holds it (`deal.offer_expires_at`) is
 * nullable with no default. Seven days is a product decision, taken so the value
 * lives in one importable place rather than as a literal at whichever call site
 * needed it first.
 *
 * `offer_expires_at` is not optional in practice even though the column allows
 * null: the sweep selects `status = 'pending' AND offer_expires_at < now()`, a
 * predicate no NULL row ever satisfies, so an offer issued without one never
 * expires — silently, with nothing failing.
 */
export const OFFER_WINDOW_DAYS = 7;

export const OFFER_WINDOW_MS = OFFER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * When an offer issued at `from` stops standing.
 *
 * `from` is a parameter rather than an inlined `new Date()` so a test can assert
 * the window without freezing the clock, and so every deal in one confirmation
 * can share a single instant instead of drifting by however long the loop took.
 */
export function offerExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + OFFER_WINDOW_MS);
}

/**
 * How long a completed video may go unmeasured before it is chased (KAN-50,
 * AC-027 final bullet).
 *
 * The second window with no document behind it, and it gets the same treatment
 * as the offer window above: a product decision, named once, imported rather
 * than retyped. Seven days, chosen to match `OFFER_WINDOW_DAYS` — a creator
 * already lives on a seven-day clock for answering an offer, and a second
 * cadence to learn would be arbitrary. Neither number is waiting on Q1 or Q2.
 *
 * **Why metrics need chasing at all.** They are recorded by hand in the MVP
 * (`lib/deals/record-metrics.ts`), so the numbers a brand's dashboard is for
 * arrive only if somebody remembers. Nothing else in the system notices that
 * they never did.
 */
export const METRICS_REMINDER_DAYS = 7;

export const METRICS_REMINDER_MS = METRICS_REMINDER_DAYS * 24 * 60 * 60 * 1000;

/**
 * The instant a reminder sweep compares completions against: a video completed
 * before this has had its whole window and is overdue.
 *
 * **Subtracts where `offerExpiresAt` adds**, and the direction is the whole
 * difference between the two helpers. An offer carries its own deadline forward
 * in a column (`deal.offer_expires_at`), so the sweep compares a stored future
 * instant against the clock. Nothing stores a metrics deadline, so this walks
 * the clock backwards to a cutoff instead — the same comparison, one fewer
 * column, and no nullable deadline that a missing value could make unreachable
 * the way an offer issued without one never expires.
 *
 * `now` is a parameter for `offerExpiresAt`'s reason and one more: a cron run
 * fires up to an hour off its schedule, so the boundary has to be assertable
 * against an injected instant rather than whatever the test machine's clock says.
 */
export function metricsOverdueBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - METRICS_REMINDER_MS);
}

/**
 * Usage-rights terms seeded into `rights_terms`.
 *
 * PROVISIONAL pending Q5 — this is engineer-written placeholder text, not legal
 * copy, and it must be replaced before anything resembling a real campaign runs.
 *
 * When the real terms arrive they land as a **new row with a new version**, not
 * as an edit to this one. Deals snapshot the version they were accepted under,
 * so rewriting `v1.0` in place would silently change what past creators are
 * recorded as having agreed to.
 */
export const RIGHTS_TERMS = {
  version: 'v1.0',
  effectiveAt: new Date('2026-07-01T00:00:00Z'),
  body: [
    'PLACEHOLDER TERMS — not legal copy, pending Q5.',
    '',
    'By accepting this offer, you grant the brand a worldwide, non-exclusive',
    'licence to use the delivered content for marketing purposes across digital',
    'channels for 12 months from the date of delivery. You retain ownership of',
    'the original content and may continue to use it yourself.',
  ].join('\n'),
} as const;
