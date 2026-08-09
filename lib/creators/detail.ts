import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, pricingTier } from '@/db/schema';
import { guard } from '@/lib/authz';
import { AUDIENCE_MARKET_LABELS } from '@/lib/config/creator-profile';
import type { AudienceMarketCode } from '@/lib/config/creator-profile';
import type { DiscoveryCreator } from '@/lib/creators/discovery';
import { BOOKABLE_CREATOR } from '@/lib/creators/queries';
import { UUID_REGEX } from '@/lib/validation';

/**
 * One creator, for the brand-facing detail view (KAN-29, AC-012, US-004).
 *
 * A sibling of `lib/creators/discovery.ts` rather than a branch inside it: the
 * list reads many rows through a filter and this reads one row by id, and the
 * only thing the two share is what a brand is allowed to see. That part *is*
 * shared — `BOOKABLE_CREATOR` and the brand gate are imported, not restated.
 *
 * AC-006 applies here exactly as it does to the list. A brand who guesses or
 * keeps a URL must not reach a pending, rejected or un-tiered creator, so the
 * bookable pair is ANDed into the lookup rather than trusted to the list being
 * the only way in. The function returns `null` for every kind of miss, so an
 * unbookable creator and one that never existed are indistinguishable from
 * outside — no existence oracle on a table brands cannot otherwise enumerate.
 */

/** The audience jsonb, narrowed to what the detail view renders. */
export interface CreatorAudience {
  /**
   * Display labels for `audience.topCountries` — known market codes resolved
   * through `AUDIENCE_MARKET_LABELS`, anything unrecognised kept verbatim.
   */
  markets: string[];
  /** The stored age range, verbatim. Null when absent or not a string. */
  ageRange: string | null;
}

/**
 * Reads the `audience` column tolerantly. It is unconstrained `jsonb`
 * (`db/schema.ts`), so its shape is a convention the onboarding form follows
 * rather than something the database enforces — and the seed already writes an
 * `ageRange` of `'18-34'`, which is not one of `AGE_RANGES`.
 *
 * So every field is checked rather than asserted, and an unknown market code
 * falls through to itself instead of a label lookup returning `undefined`. That
 * is the same `?? code` fallback the discovery page uses for a niche, applied to
 * a column whose contents nothing validates on the way in. A shape this reader
 * does not recognise renders as an absent audience, never as a crash.
 */
export function readAudience(value: unknown): CreatorAudience {
  if (typeof value !== 'object' || value === null) {
    return { markets: [], ageRange: null };
  }

  const record = value as Record<string, unknown>;
  const codes = Array.isArray(record.topCountries) ? record.topCountries : [];

  return {
    markets: codes
      .filter((code): code is string => typeof code === 'string')
      .map(
        (code) => AUDIENCE_MARKET_LABELS[code as AudienceMarketCode] ?? code
      ),
    ageRange: typeof record.ageRange === 'string' ? record.ageRange : null,
  };
}

/**
 * Everything a card shows plus the audience breakdown, with `audience` narrowed
 * from `unknown` to the shape the view renders. Narrowing it here rather than in
 * the page is what keeps `readAudience` on one side of the boundary.
 */
export interface CreatorDetail extends Omit<DiscoveryCreator, 'audience'> {
  audience: CreatorAudience;
}

/**
 * The lookup, as a `where` clause. Exported for the same reason
 * `buildDiscoveryWhere` is: asserting that the bookable pair is present is
 * easier here than through a database.
 *
 * `BOOKABLE_CREATOR` is ANDed with the id, in that order, and the id is a bound
 * parameter. The pair is not a filter this function chooses to add — it is the
 * base the id narrows, so there is no argument that produces a lookup without
 * it. Hand-writing `eq(creatorProfile.status, 'verified')` here is the version
 * that forgets the tier half; see the note in `lib/creators/queries.ts`.
 */
export function buildCreatorDetailWhere(id: string): SQL {
  // `BOOKABLE_CREATOR` is `and(...)` of two constant conditions, which drizzle
  // types as possibly-undefined because `and()` of nothing is nothing. The casts
  // keep this function's return type able to promise `SQL`.
  return and(BOOKABLE_CREATOR as SQL, eq(creatorProfile.id, id)) as SQL;
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface CreatorDetailDeps {
  requireBrand: () => Promise<unknown>;
  select: (where: SQL) => Promise<CreatorDetail | null>;
}

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database. NFR-010's "no PII beyond what a brand needs" is a
 * claim about this column list and this join, and the emitted statement is where
 * that claim is checkable: no contact column is selected and the only table
 * joined is `pricing_tier`. `pg` opens no socket until a query actually runs.
 */
export function creatorDetailQuery(where: SQL) {
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
      // Inner, as discovery joins it: a bookable creator has a tier by
      // definition, and the tier name and price are two of the three facts this
      // view exists to show. A left join would admit a null price, which is the
      // un-tiered creator AC-006 excludes.
      .innerJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
      .where(where)
      .limit(1)
  );
}

async function selectCreatorDetail(where: SQL): Promise<CreatorDetail | null> {
  const [row] = await creatorDetailQuery(where);
  if (!row) return null;
  return { ...row, audience: readAudience(row.audience) };
}

const defaultDeps: CreatorDetailDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  select: selectCreatorDetail,
};

/**
 * One bookable creator by id, or `null`. Throws `ForbiddenError` for every
 * non-brand caller, including unauthenticated ones — `guard` fails closed.
 *
 * The gate runs first, before the id is even looked at, so a denied caller
 * learns nothing about which ids are well-formed or which creators exist. The
 * shape check comes second and short-circuits the query entirely.
 */
export async function readCreatorDetail(
  id: string,
  deps: CreatorDetailDeps = defaultDeps
): Promise<CreatorDetail | null> {
  await deps.requireBrand();

  if (!UUID_REGEX.test(id)) return null;

  return deps.select(buildCreatorDetailWhere(id));
}
