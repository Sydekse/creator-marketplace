import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, pricingTier } from '@/db/schema';
import { guard } from '@/lib/authz';
import type { AudienceMarketCode, Niche } from '@/lib/config/creator-profile';
import { BOOKABLE_CREATOR } from '@/lib/creators/queries';
import { clampLimit, clampOffset } from '@/lib/paging';

/**
 * Brand-facing creator discovery (KAN-28, AC-010, AC-011, US-004).
 *
 * Two acceptance criteria meet here: filters combine with AND so that narrowing
 * only ever shrinks the result set, and only creators who are verified *and*
 * tiered are ever returned (AC-006).
 *
 * The gate is inside `readDiscovery` rather than only on the route that calls
 * it. The `/discover` page and `GET /api/creators` are two callers today and
 * more later, and a read path whose protection lives in its callers is protected
 * exactly as well as the least careful one — the same argument
 * `lib/audit/queries.ts` and `lib/creators/verification-queue.ts` make.
 */

export interface DiscoveryFilters {
  niche?: Niche;
  /** One market code, matched against the creator's `topCountries`. */
  audience?: AudienceMarketCode;
  /** Percentage, inclusive lower bound on `engagement_rate`. */
  minEngagement?: number;
  /** Inclusive bounds on the tier's `price_per_video`, in integer ETB santim. */
  priceMin?: number;
  priceMax?: number;
  limit?: number;
  offset?: number;
}

export interface DiscoveryCreator {
  id: string;
  tiktokHandle: string;
  niche: string;
  followerCount: number | null;
  engagementRate: string | null;
  audience: unknown;
  tierId: string;
  tierName: string;
  /** Integer ETB santim — the gross a brand pays per video (invariant 4). */
  pricePerVideo: number;
}

export interface DiscoveryPage {
  creators: DiscoveryCreator[];
  /** True when another page exists — derived from an over-fetch, not a COUNT. */
  hasMore: boolean;
}

/**
 * Filters are spelled snake_case on the wire because that is how tech spec §4.2
 * names them, and how the response spells its fields.
 *
 * Defined here rather than in the route so the page and the endpoint accept
 * exactly the same query string. A brand can paste a `/discover` URL into the
 * API and get the same rows back, and neither surface can drift into its own
 * private spelling of `price_min`.
 *
 * A closed map rather than a `_x -> X` regex, for the reason
 * `lib/query-params.ts` records: a general rule would invent a plausible field
 * name for anything underscored, so a misspelling would survive as a
 * plausible-looking unknown key instead of being rejected by `.strict()`.
 */
export const DISCOVERY_PARAM_ALIASES: Record<string, string> = {
  min_engagement: 'minEngagement',
  price_min: 'priceMin',
  price_max: 'priceMax',
};

/**
 * AC-011's empty state, in two halves because `EmptyState` takes a title and a
 * description separately.
 *
 * The acceptance criterion is one exact sentence pair, so the joined form is
 * kept beside the halves and asserted in the tests — that is what stops the two
 * from being paraphrased apart by a later edit to either one. Held here rather
 * than typed into the page for the same reason `ErrorMessage` holds the error
 * envelope's strings: a criterion that exists in exactly one place cannot drift.
 */
export const NO_MATCHES_TITLE = 'No creators match these filters.';
export const NO_MATCHES_DESCRIPTION = 'Try widening your criteria.';
export const NO_MATCHES_MESSAGE = `${NO_MATCHES_TITLE} ${NO_MATCHES_DESCRIPTION}`;

/**
 * Translates filters into a `where` clause. Exported for tests: asserting that
 * an absent filter contributes no condition — and that the bookable pair is
 * never absent — is easier here than through a database.
 *
 * Returns `SQL`, never `undefined`. That is the difference from
 * `buildAuditWhere`, and it is the whole security property of this module: the
 * conditions array is *seeded* with `BOOKABLE_CREATOR` before any filter is
 * read, so there is no argument — including `{}` — that produces a query
 * without it. AC-006's "pending, rejected and un-tiered creators are invisible
 * to brands" becomes a fact about this function rather than a rule each call
 * site has to remember.
 *
 * `BOOKABLE_CREATOR` is imported rather than rewritten. Hand-writing
 * `eq(creatorProfile.status, 'verified')` here is the version that quietly
 * forgets the tier check and exposes creators no campaign can price — see the
 * note in `lib/creators/queries.ts`.
 */
export function buildDiscoveryWhere(filters: DiscoveryFilters): SQL {
  // `BOOKABLE_CREATOR` is `and(...)`, which drizzle types as possibly-undefined
  // because `and()` of nothing is nothing. It is built from two constant
  // conditions and cannot be undefined in practice; the cast keeps the base
  // non-optional so this function's return type can promise `SQL`.
  const conditions: SQL[] = [BOOKABLE_CREATOR as SQL];

  if (filters.niche) conditions.push(eq(creatorProfile.niche, filters.niche));

  if (filters.minEngagement !== undefined) {
    // `numeric(5,2)` reaches drizzle as a string, so the bound is passed as one:
    // handing over a JS number makes Postgres compare the column as text, where
    // '10.00' sorts below '9.00'.
    conditions.push(
      gte(creatorProfile.engagementRate, String(filters.minEngagement))
    );
  }

  if (filters.priceMin !== undefined) {
    conditions.push(gte(pricingTier.pricePerVideo, filters.priceMin));
  }
  if (filters.priceMax !== undefined) {
    conditions.push(lte(pricingTier.pricePerVideo, filters.priceMax));
  }

  if (filters.audience) {
    // jsonb containment: does `audience -> 'topCountries'` contain this code?
    // The code is a bound parameter rather than interpolated text, so a market
    // code cannot become SQL. `@>` is also what an index on the jsonb column
    // would serve, if the catalogue ever grows enough to want one.
    conditions.push(
      sql`${creatorProfile.audience} -> 'topCountries' @> ${JSON.stringify([
        filters.audience,
      ])}::jsonb`
    );
  }

  // Non-null by construction — `conditions` always holds at least the base.
  return and(...conditions) as SQL;
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface DiscoveryDeps {
  requireBrand: () => Promise<unknown>;
  select: (
    where: SQL,
    limit: number,
    offset: number
  ) => Promise<DiscoveryCreator[]>;
}

async function selectCreators(
  where: SQL,
  limit: number,
  offset: number
): Promise<DiscoveryCreator[]> {
  return (
    db
      .select({
        id: creatorProfile.id,
        tiktokHandle: creatorProfile.tiktokHandle,
        niche: creatorProfile.niche,
        followerCount: creatorProfile.followerCount,
        engagementRate: creatorProfile.engagementRate,
        audience: creatorProfile.audience,
        tierId: pricingTier.id,
        tierName: pricingTier.name,
        pricePerVideo: pricingTier.pricePerVideo,
      })
      .from(creatorProfile)
      // Inner, not left: a bookable creator has a tier by definition, so this
      // join drops nothing the filter would have kept — and it is what supplies
      // the price to filter and display on. A left join would admit rows with a
      // null price, which is exactly the un-tiered creator AC-006 excludes.
      .innerJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
      .where(where)
      // Cheapest first: a brand shopping within a budget (AC-014) is the case
      // this list exists to serve. `id` is the stable tiebreak that pagination
      // needs — `price_per_video` is shared by every creator on a tier, so it
      // cannot order rows on its own.
      .orderBy(asc(pricingTier.pricePerVideo), asc(creatorProfile.id))
      .limit(limit)
      .offset(offset)
  );
}

const defaultDeps: DiscoveryDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  select: selectCreators,
};

/**
 * Lists bookable creators matching the filters. Throws `ForbiddenError` for
 * every non-brand caller, including unauthenticated ones — `guard` fails closed.
 *
 * The brand check runs before the query is built, so a denied caller never
 * reaches the database and cannot use response timing to learn whether creators
 * matching their filter exist.
 */
export async function readDiscovery(
  filters: DiscoveryFilters = {},
  deps: DiscoveryDeps = defaultDeps
): Promise<DiscoveryPage> {
  await deps.requireBrand();

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  // One row past the page, to answer `hasMore` without a second COUNT query
  // over a table that only ever grows.
  const creators = await deps.select(
    buildDiscoveryWhere(filters),
    limit + 1,
    offset
  );

  return {
    creators: creators.slice(0, limit),
    hasMore: creators.length > limit,
  };
}

/** A tier as the price filter's options need it. */
export interface TierPriceOption {
  id: string;
  name: string;
  /** Integer ETB santim (invariant 4) — the value the filter submits. */
  pricePerVideo: number;
}

export interface TierOptionDeps {
  requireBrand: () => Promise<unknown>;
  selectTiers: () => Promise<TierPriceOption[]>;
}

async function selectTierOptions(): Promise<TierPriceOption[]> {
  return (
    db
      .select({
        id: pricingTier.id,
        name: pricingTier.name,
        pricePerVideo: pricingTier.pricePerVideo,
      })
      .from(pricingTier)
      // Inactive tiers are excluded: a brand filtering on a band nobody can be
      // assigned to would get an empty grid and no way to tell why.
      .where(eq(pricingTier.active, true))
      .orderBy(asc(pricingTier.pricePerVideo), asc(pricingTier.id))
  );
}

const defaultTierOptionDeps: TierOptionDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  selectTiers: selectTierOptions,
};

/**
 * The price points the filter offers, read from `pricing_tier`.
 *
 * The filter is a pair of selects over real tier prices rather than two free
 * number inputs, which resolves what would otherwise be a unit trap: prices are
 * integer santim everywhere in the system (invariant 4) but a brand thinks in
 * birr, and a text box cannot be both without a conversion step that the URL
 * would then have to encode. Options carry santim as their value and ETB as
 * their label, so the query string stays in the system's units and the brand
 * never types one.
 *
 * Reading the rows rather than importing `PRICING_TIERS` keeps the filter
 * honest about what creators are actually priced at — the config is the seed's
 * source, and the two can differ until someone reseeds. Neither is hardcoded
 * here (invariant 8), so Q2 stays a one-file answer.
 */
export async function readTierPriceOptions(
  deps: TierOptionDeps = defaultTierOptionDeps
): Promise<TierPriceOption[]> {
  await deps.requireBrand();
  return deps.selectTiers();
}
