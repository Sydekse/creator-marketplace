/**
 * Pricing and commission configuration.
 *
 * PROVISIONAL — every value in this file is a placeholder pending Q1
 * (commission rate and who bears it) and Q2 (tier bands and price per video).
 * Nothing depends on the specific numbers; they exist so the marketplace loop
 * can be built and demoed before the business answers those questions.
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
