import { describe, expect, it } from 'vitest';
import {
  COMMISSION_RATE,
  PRICING_TIERS,
  RIGHTS_TERMS,
} from '@/lib/config/pricing';

/**
 * These values are placeholders pending Q1, Q2 and Q5, so the tests deliberately
 * assert *shape and invariants* rather than the numbers themselves — pinning
 * `pricePerVideo` to 150_000 would just mean editing this file every time the
 * business answers a question.
 *
 * What they do catch is the failure that actually costs something: a replacement
 * value that violates invariant 4 (integer santim) or the numeric(5,2) column
 * shape, which would otherwise get as far as a seeded database before anyone
 * noticed.
 */

/** Matches Postgres numeric(5, 2) as drizzle round-trips it: a string. */
const NUMERIC_5_2 = /^\d{1,3}\.\d{2}$/;

describe('COMMISSION_RATE', () => {
  it('is a numeric(5, 2)-shaped string, not a number', () => {
    // A float here would reach `deal.commission_rate` through drizzle's numeric
    // mapping and reintroduce exactly the drift KAN-40 §3.3 avoids.
    expect(typeof COMMISSION_RATE).toBe('string');
    expect(COMMISSION_RATE).toMatch(NUMERIC_5_2);
  });

  it('is a percentage between 0 and 100', () => {
    const rate = Number(COMMISSION_RATE);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(100);
  });

  it('converts to whole basis points', () => {
    // The ledger does `Math.round(Number(rate) * 100)`. A rate with sub-basis-
    // point precision would silently round, so payout would not reconcile with
    // the rate the deal claims to have been offered at.
    const bp = Number(COMMISSION_RATE) * 100;
    expect(Number.isInteger(bp)).toBe(true);
  });
});

describe('PRICING_TIERS', () => {
  it('seeds the three tiers AC1 names', () => {
    expect(PRICING_TIERS.map((t) => t.name)).toEqual(['Micro', 'Mid', 'Macro']);
  });

  it('has unique names', () => {
    // `pricing_tier.name` is unique, and the seed relies on that for
    // `onConflictDoNothing()` to be a genuine no-op rather than a silent drop.
    const names = PRICING_TIERS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(PRICING_TIERS)(
    '$name: pricePerVideo is a positive integer in santim',
    ({ pricePerVideo }) => {
      // Invariant 4 — money is integer santim, never a float. `1_500.50` would
      // be a plausible-looking typo when real ETB prices land.
      expect(Number.isInteger(pricePerVideo)).toBe(true);
      expect(pricePerVideo).toBeGreaterThan(0);
    }
  );

  it.each(PRICING_TIERS)(
    '$name: minFollowers is a non-negative integer',
    ({ minFollowers }) => {
      expect(Number.isInteger(minFollowers)).toBe(true);
      expect(minFollowers).toBeGreaterThanOrEqual(0);
    }
  );

  it.each(PRICING_TIERS)(
    '$name: minEngagement is a numeric(5, 2)-shaped string',
    ({ minEngagement }) => {
      expect(minEngagement).toMatch(NUMERIC_5_2);
      expect(Number(minEngagement)).toBeLessThanOrEqual(100);
    }
  );

  it('ascends by follower threshold and by price together', () => {
    // A ladder that crosses over — a cheaper tier requiring more followers —
    // would make tier selection incoherent for the brand picking creators
    // within budget (AC-014).
    for (let i = 1; i < PRICING_TIERS.length; i++) {
      const prev = PRICING_TIERS[i - 1];
      const curr = PRICING_TIERS[i];
      expect(curr.minFollowers).toBeGreaterThan(prev.minFollowers);
      expect(curr.pricePerVideo).toBeGreaterThan(prev.pricePerVideo);
    }
  });
});

describe('RIGHTS_TERMS', () => {
  it('carries a version string', () => {
    // Q5 is open, but AC4 requires the row be versioned regardless — deals
    // snapshot this string as the legal record of what was agreed.
    expect(RIGHTS_TERMS.version).toMatch(/^v\d+\.\d+$/);
  });

  it('is marked as placeholder text', () => {
    // The guard against the placeholder quietly becoming the real terms.
    expect(RIGHTS_TERMS.body).toMatch(/PLACEHOLDER/i);
  });

  it('has a non-empty body and a real effective date', () => {
    expect(RIGHTS_TERMS.body.trim().length).toBeGreaterThan(0);
    expect(RIGHTS_TERMS.effectiveAt).toBeInstanceOf(Date);
    expect(Number.isNaN(RIGHTS_TERMS.effectiveAt.getTime())).toBe(false);
  });
});
