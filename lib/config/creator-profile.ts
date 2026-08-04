/**
 * The option sets a creator picks from during onboarding (US-001, AC-001).
 *
 * These are closed lists rather than free text, and that is a functional
 * decision rather than a UI one: AC-010 filters discovery by niche and audience
 * and combines the filters with AND. A brand filtering for `beauty` must match
 * every creator who means beauty, so "Beauty", "beauty & skincare" and
 * "Beauty/Skincare" cannot be three separate values in the column.
 *
 * Unlike `lib/config/pricing.ts`, none of this is blocked on an open question —
 * the PRD does not enumerate niches, and nothing downstream depends on the exact
 * membership of the list. Adding a niche later is a one-line change here plus a
 * migration-free deploy, because the column stays `text`.
 *
 * `lifestyle` and `fitness` are load-bearing: `db/seed.ts` assigns them to the
 * two demo creators, so removing either would leave seeded rows holding a niche
 * the form can no longer produce.
 */

export const NICHES = [
  'beauty',
  'comedy',
  'education',
  'fashion',
  'fitness',
  'food',
  'gaming',
  'lifestyle',
  'music',
  'tech',
  'travel',
] as const;

export type Niche = (typeof NICHES)[number];

/** Human-facing labels. The stored value is always the lowercase key above. */
export const NICHE_LABELS: Record<Niche, string> = {
  beauty: 'Beauty',
  comedy: 'Comedy',
  education: 'Education',
  fashion: 'Fashion',
  fitness: 'Fitness',
  food: 'Food & drink',
  gaming: 'Gaming',
  lifestyle: 'Lifestyle',
  music: 'Music',
  tech: 'Tech',
  travel: 'Travel',
};

/**
 * Audience age bands.
 *
 * Non-overlapping on purpose. Overlapping bands would make an AC-010 range
 * filter ambiguous — a creator in both `18-24` and `18-34` would match or miss
 * depending on which band the brand picked, for no reason the brand can see.
 *
 * Note that `db/seed.ts` stores `'18-34'` on its demo rows, which predates this
 * list. That is harmless: `audience` is unconstrained `jsonb` and is only read
 * for display, so the seeded value renders fine and simply cannot be reproduced
 * through the form.
 */
export const AGE_RANGES = ['13-17', '18-24', '25-34', '35-44', '45+'] as const;

export type AgeRange = (typeof AGE_RANGES)[number];

/**
 * Markets a creator's audience can sit in, as ISO 3166-1 alpha-2 codes.
 *
 * Ethiopia leads because this is an Ethiopian marketplace priced in ETB; the
 * rest are the diaspora and regional markets a brand advertising here would
 * plausibly target. Stored as codes rather than names so the value is stable if
 * the display label is ever localised.
 */
export const AUDIENCE_MARKET_CODES = [
  'ET',
  'KE',
  'SO',
  'AE',
  'US',
  'GB',
] as const;

export type AudienceMarketCode = (typeof AUDIENCE_MARKET_CODES)[number];

export const AUDIENCE_MARKET_LABELS: Record<AudienceMarketCode, string> = {
  ET: 'Ethiopia',
  KE: 'Kenya',
  SO: 'Somalia',
  AE: 'UAE',
  US: 'United States',
  GB: 'United Kingdom',
};

/**
 * Engagement rate is stored in `creator_profile.engagement_rate`, a
 * `numeric(5, 2)`. That column would physically accept 999.99, but an
 * engagement *rate* above 100% is not a real measurement, so the schema caps it
 * at 100 rather than at what the column happens to allow.
 */
export const MAX_ENGAGEMENT_RATE = 100;
