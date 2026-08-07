import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatEtb } from '../lib/money';
import { formatEtb as formatEtbFromNotifications } from '../lib/notifications';
import { formatCommissionRate, priceForTier } from '../lib/creators/pricing';
import { computeSplit } from '../lib/payment/ledger';
import { COMMISSION_RATE } from '../lib/config/pricing';
import {
  missingFieldLabel,
  missingTierFields,
  type TierableProfile,
} from '../lib/creators/tier-rules';
import { selectTier } from '../lib/creators/tier-assignment';
import type { TierCandidate } from '../lib/creators/tier-assignment';

/**
 * KAN-24 — the creator sees their tier and price (US-002, AC-005).
 *
 * Prices and rates here are invented, never imported from
 * `lib/config/pricing.ts` for an assertion. Q1 and Q2 are open: a suite that
 * asserted `'15.00'` would fail the day someone answers the question rather than
 * on a regression. `COMMISSION_RATE` is imported once, to prove the *default*
 * comes from config — not to assert what it currently is.
 */

/** A tier row as `getCreatorProfileWithTier` returns it. */
const MICRO = { name: 'Micro', pricePerVideo: 1_500_00 };

describe('priceForTier', () => {
  it('names the tier and passes the brand price through untouched', () => {
    const pricing = priceForTier(MICRO, '15.00');

    expect(pricing.tierName).toBe('Micro');
    // AC-005's "matches the tier price exactly" — not rounded, not re-derived.
    expect(pricing.pricePerVideo).toBe(1_500_00);
  });

  it('takes its commission from computeSplit rather than its own arithmetic', () => {
    // The whole point of the module: display math and ledger math are one
    // implementation, so a shown payout and a paid payout cannot disagree.
    const rate = '15.00';
    const pricing = priceForTier(MICRO, rate);

    expect({
      commission: pricing.commission,
      payout: pricing.payout,
    }).toEqual(computeSplit(MICRO.pricePerVideo, rate));
  });

  it('defaults the rate to the configured one', () => {
    // Asserts the wiring, not the value — `COMMISSION_RATE` is provisional (Q1).
    expect(priceForTier(MICRO).commissionRate).toBe(COMMISSION_RATE);
    expect(priceForTier(MICRO)).toEqual(priceForTier(MICRO, COMMISSION_RATE));
  });

  it('reads the rate from its argument, not a constant', () => {
    // Invariant 8: a deal carries its own snapshotted rate, so pricing one under
    // an older rate has to be possible. Two different rates must give two
    // different splits or the parameter is decoration.
    const cheap = priceForTier(MICRO, '5.00');
    const dear = priceForTier(MICRO, '25.00');

    expect(cheap.commission).toBeLessThan(dear.commission);
    expect(cheap.payout).toBeGreaterThan(dear.payout);
    expect(cheap.commissionRate).toBe('5.00');
  });

  it('reconciles: payout + commission is always the gross', () => {
    // AC-3 shows all three numbers on one screen, so a creator can add them up.
    // If they do not sum, the commission looks like a different price.
    const prices = [0, 1, 99, 100, 333_33, 1_500_00, 9_999_999_99];
    const rates = ['0.00', '0.01', '5.00', '15.00', '33.33', '50.00', '100.00'];

    for (const pricePerVideo of prices) {
      for (const rate of rates) {
        const p = priceForTier({ name: 'T', pricePerVideo }, rate);

        expect(p.commission + p.payout).toBe(pricePerVideo);
        expect(Number.isInteger(p.commission)).toBe(true);
        expect(Number.isInteger(p.payout)).toBe(true);
        expect(p.payout).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/**
 * AC-005's first clause — the brand's number and the creator's number are one
 * number.
 *
 * Discovery (KAN-28) does not exist yet, so this cannot compare two screens. It
 * asserts the thing that will make them agree once it does: both sides price a
 * tier by calling `priceForTier` on the row read from `pricing_tier`, and that
 * function is a pure function of the row.
 */
describe('AC-005 — no divergence between the brand and creator views', () => {
  it('gives the same integer to both callers from the same tier row', () => {
    const row = { id: 'tier-micro', name: 'Micro', pricePerVideo: 1_500_00 };

    // What the creator dashboard renders.
    const creatorFacing = priceForTier(row);
    // What a brand-facing card would render from the same row.
    const brandFacing = priceForTier(row);

    expect(creatorFacing.pricePerVideo).toBe(brandFacing.pricePerVideo);
    expect(creatorFacing.pricePerVideo).toBe(row.pricePerVideo);
    expect(formatEtb(creatorFacing.pricePerVideo)).toBe(
      formatEtb(brandFacing.pricePerVideo)
    );
  });

  it('is a pure function of the row, so neither view can perturb it', () => {
    const row = { name: 'Micro', pricePerVideo: 1_500_00 };

    expect(priceForTier(row)).toEqual(priceForTier({ ...row }));
    // Nothing is mutated on the way through.
    expect(row).toEqual({ name: 'Micro', pricePerVideo: 1_500_00 });
  });
});

// -- Money formatting, from its new home ------------------------------------

describe('formatEtb', () => {
  it.each([
    [0, '0.00 ETB'],
    [1, '0.01 ETB'],
    [99, '0.99 ETB'],
    [100, '1.00 ETB'],
    [1_05, '1.05 ETB'],
    [1_500_00, '1,500.00 ETB'],
    [9_999_999_99, '9,999,999.99 ETB'],
  ])('renders %i santim as %s', (santim, expected) => {
    expect(formatEtb(santim)).toBe(expected);
  });

  it('uses a minus sign, not a hyphen, for negatives', () => {
    // These sit beside amounts in ledger and commission contexts, where a hyphen
    // reads as a dash rather than as a sign.
    expect(formatEtb(-225_00)).toBe('−225.00 ETB');
    expect(formatEtb(-1)).toBe('−0.01 ETB');
  });

  it('lets no float touch the value', () => {
    // `2.675`-class rounding is the failure AC-005's last clause names. Integer
    // division and modulo cannot produce it; `santim / 100` would.
    expect(formatEtb(267_5)).toBe('26.75 ETB');
    expect(formatEtb(8_10)).toBe('8.10 ETB');
    expect(formatEtb(70)).toBe('0.70 ETB');
  });

  it('is the same function the notification emails use', () => {
    // Promoted to `lib/money.ts` on KAN-24 and re-exported from
    // `lib/notifications`, so an email and a dashboard cannot format one amount
    // two ways. Identity, not equivalence — a copy would pass an output check.
    expect(formatEtbFromNotifications).toBe(formatEtb);
  });
});

describe('formatCommissionRate', () => {
  it.each([
    ['15.00', '15%'],
    ['12.50', '12.5%'],
    ['0.00', '0%'],
    ['100.00', '100%'],
    ['7.05', '7.05%'],
  ])('renders %s as %s', (rate, expected) => {
    expect(formatCommissionRate(rate)).toBe(expected);
  });

  it('does not render a missing rate as 0%', () => {
    // Unreachable through the app — `commission_rate` is `numeric(5,2)`. But
    // `Number('')` is 0, so the naive version says the platform takes nothing,
    // which is the one wrong answer a creator would believe.
    expect(formatCommissionRate('')).toBe('%');
    expect(formatCommissionRate('   ')).toBe('%');
    expect(formatCommissionRate('not a rate')).toBe('not a rate%');
  });
});

// -- AC-4: what is missing, and who decides ---------------------------------

/**
 * AC-4 asks the untiered creator to be told *what data is missing*. The answer
 * has to be the same one that refused to price them, or the screen sends people
 * to fix a field the rule was happy with — which is exactly the defect F13
 * recorded in the admin list.
 */
describe('missingTierFields', () => {
  function profile(overrides: Partial<TierableProfile> = {}): TierableProfile {
    return { followerCount: 50_000, engagementRate: '4.00', ...overrides };
  }

  it('names nothing when both numbers are usable', () => {
    expect(missingTierFields(profile())).toEqual([]);
  });

  it.each([
    ['follower count', { followerCount: null }, ['followerCount']],
    ['engagement rate', { engagementRate: null }, ['engagementRate']],
    [
      'both',
      { followerCount: null, engagementRate: null },
      ['followerCount', 'engagementRate'],
    ],
  ])('names %s', (_label, overrides, expected) => {
    expect(missingTierFields(profile(overrides))).toEqual(expected);
  });

  it('treats an unusable value as missing, not as zero', () => {
    // Zero is a claim; garbage is not. A creator whose stored rate cannot be
    // parsed needs to be asked for it again, not priced as if they had answered.
    expect(missingTierFields(profile({ engagementRate: 'nonsense' }))).toEqual([
      'engagementRate',
    ]);
    expect(missingTierFields(profile({ engagementRate: '' }))).toEqual([
      'engagementRate',
    ]);
    expect(missingTierFields(profile({ engagementRate: '-1.00' }))).toEqual([
      'engagementRate',
    ]);
    expect(missingTierFields(profile({ followerCount: -1 }))).toEqual([
      'followerCount',
    ]);
    expect(missingTierFields(profile({ followerCount: Number.NaN }))).toEqual([
      'followerCount',
    ]);
  });

  it('does not treat zero as missing', () => {
    // Zero followers is an answer. Such a creator falls below every band —
    // `no_matching_tier`, a different thing to tell them than "we need a number".
    expect(
      missingTierFields({ followerCount: 0, engagementRate: '0.00' })
    ).toEqual([]);
  });

  it('is ordered, so the sentence a creator reads is stable', () => {
    expect(
      missingTierFields({ followerCount: null, engagementRate: null })
    ).toEqual(['followerCount', 'engagementRate']);
  });

  /**
   * The agreement that makes the extraction worth anything: for every profile,
   * `missingTierFields` is non-empty exactly when `selectTier` answers
   * `missing_data`. If they disagree, one screen is lying.
   */
  it('agrees with selectTier on every case', () => {
    const ladder: TierCandidate[] = [
      {
        id: 'tier-a',
        name: 'A',
        pricePerVideo: 100_00,
        minFollowers: 0,
        minEngagement: null,
        active: true,
      },
    ];

    const cases: TierableProfile[] = [
      { followerCount: 50_000, engagementRate: '4.00' },
      { followerCount: 0, engagementRate: '0.00' },
      { followerCount: null, engagementRate: '4.00' },
      { followerCount: 50_000, engagementRate: null },
      { followerCount: null, engagementRate: null },
      { followerCount: -1, engagementRate: '4.00' },
      { followerCount: Number.NaN, engagementRate: '4.00' },
      { followerCount: Number.POSITIVE_INFINITY, engagementRate: '4.00' },
      { followerCount: 50_000, engagementRate: '' },
      { followerCount: 50_000, engagementRate: '   ' },
      { followerCount: 50_000, engagementRate: 'nonsense' },
      { followerCount: 50_000, engagementRate: '-0.01' },
    ];

    for (const p of cases) {
      const outcome = selectTier(ladder, p);
      const saysMissing =
        !outcome.assigned && outcome.reason === 'missing_data';

      expect({ profile: p, missing: missingTierFields(p).length > 0 }).toEqual({
        profile: p,
        missing: saysMissing,
      });
    }
  });
});

describe('missingFieldLabel', () => {
  it('gives one wording for both the creator and the admin screen', () => {
    expect(missingFieldLabel('followerCount')).toBe('follower count');
    expect(missingFieldLabel('engagementRate')).toBe('engagement rate');
  });
});

// -- Structural guards ------------------------------------------------------

/**
 * The behavioural tests above would all pass if the pricing module carried its
 * own commission rate or a fallback price. Reading the source is the only way to
 * assert it does not — the same guard KAN-23 put on `tier-assignment.ts`, for
 * the same reason: Q1 and Q2 must stay answerable in one place.
 */
describe('pricing.ts hardcodes no rate or price', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../lib/creators/pricing.ts', import.meta.url)),
    'utf8'
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('names no tier', () => {
    expect(code).not.toMatch(/Micro|Mid\b|Macro/);
  });

  it('carries no numeric literal that could be a rate or a price', () => {
    const literals = (code.match(/\d[\d_]*(\.\d+)?/g) ?? []).filter(
      (n) => Number(n.replaceAll('_', '')) > 1
    );
    expect(literals).toEqual([]);
  });

  it('takes its default rate from config rather than a literal', () => {
    expect(code).toMatch(/COMMISSION_RATE/);
  });
});

/**
 * AC-5 — amounts render from integer santim with no floating-point drift.
 *
 * The component is not proven to render (no DOM environment in this project —
 * see `__tests__/ui-primitives.test.ts`), so this asserts the property that would
 * break it: every amount reaches the screen through `formatEtb`, and none is
 * divided or multiplied on the way.
 */
describe('the creator pricing block formats money through formatEtb only', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL('../components/creator/tier-pricing.tsx', import.meta.url)
    ),
    'utf8'
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('imports the shared formatter', () => {
    expect(code).toMatch(/import \{ formatEtb \} from '@\/lib\/money'/);
  });

  it('divides or multiplies no amount', () => {
    // `/ 100` in a component is the santim bug AC-5 names. The only arithmetic
    // here is the display negation of the commission.
    expect(code).not.toMatch(/[)\w\s]\/\s*100\b/);
    expect(code).not.toMatch(/\*\s*100\b/);
    expect(code).not.toMatch(/toFixed/);
  });

  it('prices from the tier row rather than a literal', () => {
    expect(code).toMatch(/priceForTier/);
    // Tailwind class names are full of numbers (`gap-4`, `py-2`), so they come
    // out first — otherwise this guard is noise and gets deleted by the next
    // person who touches the layout.
    const literals = (
      code.replace(/className="[^"]*"/g, '').match(/\b\d[\d_]*(\.\d+)?\b/g) ??
      []
    ).filter((n) => Number(n.replaceAll('_', '')) > 1);
    expect(literals).toEqual([]);
  });

  it('asks missingTierFields rather than checking the columns itself', () => {
    // F13's rule, applied to the screen this ticket adds.
    expect(code).toMatch(/missingTierFields/);
    expect(code).not.toMatch(/followerCount\s*===\s*null/);
    expect(code).not.toMatch(/engagementRate\s*===\s*null/);
  });

  it('quotes no tier threshold to the creator', () => {
    // Provisional Q2 values. Publishing a number a creator would then chase is a
    // product decision nobody has made.
    expect(code).not.toMatch(/Micro|Mid\b|Macro/);
  });
});
