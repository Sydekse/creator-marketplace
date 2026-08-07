import { COMMISSION_RATE } from '@/lib/config/pricing';
import { computeSplit } from '@/lib/payment/ledger';

/**
 * What one video on a tier costs, and what the creator keeps (KAN-24, AC-005).
 *
 * AC-005 requires the price a brand is shown and the price the creator is shown
 * to be the same number. That is a property of *where the number comes from*, not
 * of two screens agreeing by inspection, so this module exists to be the single
 * source: the creator dashboard reads it today, and discovery (KAN-28) reads it
 * rather than computing a price of its own. There is no second place a price can
 * be derived, which is what makes "no divergence" structural.
 *
 * The commission is not re-derived here either — `computeSplit` is the KAN-40
 * ledger math under the NFR-009 100%-coverage mandate, deriving payout by
 * subtraction so gross always reconciles. A second implementation of the same
 * arithmetic on the display path is exactly how a shown figure and a paid figure
 * drift apart.
 *
 * No number in this file is a price or a rate. Both come from the arguments, and
 * the default rate comes from `lib/config/pricing.ts` (invariant 8), so Q1 and Q2
 * stay answerable in one place.
 */

export interface TierPricing {
  tierName: string;
  /** Integer ETB santim — the gross a brand pays for one video (AC-005). */
  pricePerVideo: number;
  /** Percentage string, as `numeric(5,2)` reaches us from drizzle ('15.00'). */
  commissionRate: string;
  /** Integer santim withheld by the platform, stated rather than implied (AC-3). */
  commission: number;
  /** Integer santim the creator receives, net of commission. */
  payout: number;
}

/**
 * Prices one tier for display.
 *
 * `commissionRate` is a parameter with a default rather than a constant read
 * inside, because invariant 8 snapshots `deal.commission_rate` onto each deal at
 * offer time. Pre-offer there is no snapshot to read, so the creator's figure is
 * an estimate at the currently configured rate — and once a deal exists, its own
 * rate is what should be passed in. Baking `COMMISSION_RATE` in would make the
 * estimate look like a promise and leave no way to price a deal that was struck
 * under an older rate.
 */
export function priceForTier(
  tier: { name: string; pricePerVideo: number },
  commissionRate: string = COMMISSION_RATE
): TierPricing {
  const { commission, payout } = computeSplit(
    tier.pricePerVideo,
    commissionRate
  );

  return {
    tierName: tier.name,
    pricePerVideo: tier.pricePerVideo,
    commissionRate,
    commission,
    payout,
  };
}

/**
 * The commission rate as a human percentage — `'15.00'` → `'15%'`.
 *
 * Trailing zeros in the cents place are dropped because they are an artefact of
 * the column type, not information: `numeric(5,2)` stores 15% as `'15.00'`, and
 * "15.00%" on a dashboard reads as a precision the business has not claimed. A
 * genuine fractional rate ('12.50') keeps its digits.
 */
export function formatCommissionRate(commissionRate: string): string {
  const trimmed = commissionRate.trim();
  // Blank is checked before `Number`, which maps '' to 0 — and rendering a
  // missing rate as "0%" would tell a creator the platform takes nothing, the
  // one wrong answer here that looks like a real one. Same guard, same reason, as
  // `toBasisPoints` in `lib/creators/tier-rules.ts`.
  const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(parsed)) return `${trimmed}%`;
  // `parseFloat`-style normalisation via Number: 15.00 -> 15, 12.50 -> 12.5.
  return `${parsed}%`;
}
