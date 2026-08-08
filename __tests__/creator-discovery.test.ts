import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ForbiddenError } from '../lib/authz';
import {
  AUDIENCE_MARKET_CODES,
  MAX_ENGAGEMENT_RATE,
  NICHES,
} from '../lib/config/creator-profile';
import {
  DISCOVERY_PARAM_ALIASES,
  NO_MATCHES_DESCRIPTION,
  NO_MATCHES_MESSAGE,
  NO_MATCHES_TITLE,
  buildDiscoveryWhere,
  readDiscovery,
  readTierPriceOptions,
} from '../lib/creators/discovery';
import type {
  DiscoveryCreator,
  DiscoveryDeps,
  TierPriceOption,
} from '../lib/creators/discovery';
import { MAX_PAGE_SIZE, PAGE_SIZE } from '../lib/paging';
import {
  conflictDetails,
  readParams,
  searchParamsFrom,
} from '../lib/query-params';
import { discoverCreatorsSchema } from '../lib/validation';
import { handleDiscoverCreators } from '../app/api/creators/route';

/**
 * KAN-28 — brand-facing discovery (US-004, AC-010, AC-011).
 *
 * The security property is asserted first and then again inside every other
 * group: no input produces a query without the bookable pair. AC-006 says
 * pending, rejected and un-tiered creators are invisible to brands, and the only
 * way that stays true is if it cannot be turned off by a filter, an empty filter
 * object, or a caller who forgets.
 */

const dialect = new PgDialect();
const toSql = (filters: Parameters<typeof buildDiscoveryWhere>[0]) =>
  dialect.sqlToQuery(buildDiscoveryWhere(filters)).sql;

const BRAND_USER = { id: 'user-brand', role: 'brand' } as const;

const row = (over: Partial<DiscoveryCreator> = {}): DiscoveryCreator => ({
  id: 'creator-1',
  tiktokHandle: '@demo_creator',
  niche: 'lifestyle',
  followerCount: 25_000,
  engagementRate: '3.50',
  audience: { topCountries: ['ET'], ageRange: '18-34' },
  tierId: 'tier-micro',
  tierName: 'Micro',
  pricePerVideo: 150_000,
  ...over,
});

// -- The bookable rule ------------------------------------------------------

describe('buildDiscoveryWhere — the bookable pair is not optional', () => {
  /**
   * Both halves of AC-006, as they appear in the generated SQL. Asserted as
   * fragments rather than a whole statement so that a change to drizzle's
   * quoting or parameter numbering does not fail a test about access control.
   */
  const assertBookable = (sql: string) => {
    expect(sql).toContain('"status"');
    expect(sql).toContain('"tier_id" is not null');
  };

  it('includes it for no filters at all', () => {
    // The difference from `buildAuditWhere`, which returns `undefined` here.
    // A discovery query with no WHERE would be the whole creator table.
    assertBookable(toSql({}));
  });

  it('includes it for paging, which is not filtering', () => {
    assertBookable(toSql({ limit: 10, offset: 20 }));
  });

  it('includes it for every single filter on its own', () => {
    assertBookable(toSql({ niche: 'beauty' }));
    assertBookable(toSql({ audience: 'ET' }));
    assertBookable(toSql({ minEngagement: 4 }));
    assertBookable(toSql({ priceMin: 150_000 }));
    assertBookable(toSql({ priceMax: 500_000 }));
  });

  it('includes it with every filter set at once', () => {
    assertBookable(
      toSql({
        niche: 'tech',
        audience: 'GB',
        minEngagement: 5,
        priceMin: 150_000,
        priceMax: 1_500_000,
        limit: 5,
        offset: 5,
      })
    );
  });

  it('never returns undefined, whatever it is handed', () => {
    // The type says so; this is the runtime half. `and()` of an empty list is
    // `undefined`, and drizzle reads `undefined` as "no WHERE clause" — so a
    // future filter that emptied the conditions array would silently publish
    // every creator row rather than failing.
    expect(buildDiscoveryWhere({})).toBeDefined();
    expect(buildDiscoveryWhere({ niche: 'food' })).toBeDefined();
  });

  it("leaves the status filter out of the caller's hands", () => {
    // There is no `status` or `tier` key to supply, so a caller cannot ask for
    // pending creators even by guessing the column name.
    const parsed = discoverCreatorsSchema.safeParse({
      status: 'pending_verification',
    });
    expect(parsed.success).toBe(false);
  });
});

// -- Filters ----------------------------------------------------------------

describe('buildDiscoveryWhere — filters', () => {
  it('adds nothing for a filter that was not given', () => {
    const bare = toSql({});
    expect(bare).not.toContain('"niche"');
    expect(bare).not.toContain('"engagement_rate"');
    expect(bare).not.toContain('"price_per_video"');
    expect(bare).not.toContain('topCountries');
  });

  it('filters on niche', () => {
    expect(toSql({ niche: 'beauty' })).toContain('"niche"');
  });

  it('filters on engagement as a lower bound', () => {
    expect(toSql({ minEngagement: 4.5 })).toContain('"engagement_rate" >=');
  });

  it('passes the engagement bound as a string, not a number', () => {
    // `numeric(5,2)` reaches drizzle as a string. Handing over a JS number makes
    // Postgres compare the column as text, where '10.00' sorts below '9.00' —
    // so a brand asking for ≥9% would lose every creator in double digits.
    const { params } = dialect.sqlToQuery(
      buildDiscoveryWhere({ minEngagement: 9 })
    );
    expect(params).toContain('9');
    expect(params).not.toContain(9);
  });

  it('filters on price as an inclusive range over the tier', () => {
    const sql = toSql({ priceMin: 150_000, priceMax: 500_000 });
    expect(sql).toContain('"price_per_video" >=');
    expect(sql).toContain('"price_per_video" <=');
  });

  it('filters price in integer santim, never birr', () => {
    // Invariant 4. The value reaching SQL is the same unit the column holds, so
    // no conversion sits between the filter and the price it compares against.
    const { params } = dialect.sqlToQuery(
      buildDiscoveryWhere({ priceMin: 150_000 })
    );
    expect(params).toContain(150_000);
  });

  it('filters on one market inside the audience jsonb', () => {
    const sql = toSql({ audience: 'ET' });
    expect(sql).toContain("'topCountries'");
    expect(sql).toContain('@>');
  });

  it('binds the market code rather than interpolating it', () => {
    // A market code that reached the statement as text would be an injection
    // point, however closed the enum in front of it is today.
    const { sql, params } = dialect.sqlToQuery(
      buildDiscoveryWhere({ audience: 'KE' })
    );
    expect(sql).not.toContain('KE');
    expect(params).toContain('["KE"]');
  });

  it('combines filters with AND, never OR (AC-010)', () => {
    const sql = toSql({ niche: 'beauty', minEngagement: 4, priceMax: 500_000 });
    expect(sql).toContain(' and ');
    expect(sql).not.toContain(' or ');
  });
});

// -- The gate ---------------------------------------------------------------

describe('readDiscovery', () => {
  const okDeps = (rows: DiscoveryCreator[] = []): DiscoveryDeps => ({
    requireBrand: async () => BRAND_USER,
    select: async () => rows,
  });

  it('returns the page for a brand', async () => {
    const page = await readDiscovery({}, okDeps([row()]));
    expect(page.creators).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it.each(['creator', 'admin', 'anonymous'])(
    'denies a %s caller',
    async (who) => {
      const select = vi.fn();
      const deps: DiscoveryDeps = {
        requireBrand: async () => {
          throw new ForbiddenError(`role ${who} not permitted`);
        },
        select,
      };

      await expect(readDiscovery({}, deps)).rejects.toBeInstanceOf(
        ForbiddenError
      );
      // The gate runs before the query, so a denied caller cannot use response
      // timing to learn whether creators matching their filter exist.
      expect(select).not.toHaveBeenCalled();
    }
  );

  it('over-fetches by one to answer hasMore without a COUNT', async () => {
    let asked = 0;
    const page = await readDiscovery(
      { limit: 2 },
      {
        requireBrand: async () => BRAND_USER,
        select: async (_where, limit) => {
          asked = limit;
          return [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
        },
      }
    );

    expect(asked).toBe(3);
    // The extra row answers the question and is then dropped, never rendered.
    expect(page.creators.map((c) => c.id)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
  });

  it('clamps a hand-edited limit to the page ceiling', async () => {
    let asked = 0;
    await readDiscovery(
      { limit: 10_000 },
      {
        requireBrand: async () => BRAND_USER,
        select: async (_where, limit) => {
          asked = limit;
          return [];
        },
      }
    );
    expect(asked).toBe(MAX_PAGE_SIZE + 1);
  });

  it('defaults to one page and no offset', async () => {
    let asked: [number, number] = [0, 0];
    await readDiscovery(
      {},
      {
        requireBrand: async () => BRAND_USER,
        select: async (_where, limit, offset) => {
          asked = [limit, offset];
          return [];
        },
      }
    );
    expect(asked).toEqual([PAGE_SIZE + 1, 0]);
  });
});

describe('readTierPriceOptions', () => {
  const tiers: TierPriceOption[] = [
    { id: 't1', name: 'Micro', pricePerVideo: 150_000 },
    { id: 't2', name: 'Mid', pricePerVideo: 500_000 },
  ];

  it('is gated to brands like the query it serves', async () => {
    const selectTiers = vi.fn();
    await expect(
      readTierPriceOptions({
        requireBrand: async () => {
          throw new ForbiddenError('role creator not permitted');
        },
        selectTiers,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(selectTiers).not.toHaveBeenCalled();
  });

  it('returns prices in santim, the unit the filter submits', async () => {
    const options = await readTierPriceOptions({
      requireBrand: async () => BRAND_USER,
      selectTiers: async () => tiers,
    });
    expect(options.map((t) => t.pricePerVideo)).toEqual([150_000, 500_000]);
  });
});

// -- The endpoint -----------------------------------------------------------

describe('GET /api/creators', () => {
  const url = (query = '') => `http://localhost/api/creators${query}`;

  const okDeps = (rows: DiscoveryCreator[] = []): DiscoveryDeps => ({
    requireBrand: async () => BRAND_USER,
    select: async () => rows,
  });

  it.each(['creator', 'admin', 'anonymous'])(
    'answers 403 FORBIDDEN for a %s caller',
    async (who) => {
      const select = vi.fn();
      const response = await handleDiscoverCreators(new Request(url()), {
        requireBrand: async () => {
          throw new ForbiddenError(`role ${who} not permitted`);
        },
        select,
      });

      // The AC asks for 403 where tech spec §4.2 says 401 for anonymous. Failing
      // closed without distinguishing "no session" from "wrong role" is what
      // keeps this endpoint from being an existence oracle.
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('FORBIDDEN');
      expect(select).not.toHaveBeenCalled();
    }
  );

  it('returns the bookable set for an empty query string', async () => {
    const response = await handleDiscoverCreators(
      new Request(url()),
      okDeps([row()])
    );
    expect(response.status).toBe(200);
    expect((await response.json()).creators).toHaveLength(1);
  });

  it('serialises in snake_case with the tier nested', async () => {
    const response = await handleDiscoverCreators(
      new Request(url()),
      okDeps([row()])
    );

    const body = await response.json();
    expect(body.has_more).toBe(false);
    expect(body.creators[0]).toEqual({
      id: 'creator-1',
      tiktok_handle: '@demo_creator',
      niche: 'lifestyle',
      follower_count: 25_000,
      engagement_rate: '3.50',
      audience: { topCountries: ['ET'], ageRange: '18-34' },
      tier: { id: 'tier-micro', name: 'Micro', price_per_video: 150_000 },
    });
  });

  it('accepts the snake_case filters the contract names', async () => {
    let seen: SQL | undefined;
    const response = await handleDiscoverCreators(
      new Request(
        url(
          '?niche=beauty&min_engagement=4&price_min=150000&price_max=500000&audience=ET'
        )
      ),
      {
        requireBrand: async () => BRAND_USER,
        select: async (where) => {
          seen = where;
          return [];
        },
      }
    );

    expect(response.status).toBe(200);
    const { sql } = dialect.sqlToQuery(seen as SQL);
    expect(sql).toContain('"niche"');
    expect(sql).toContain('"engagement_rate" >=');
    expect(sql).toContain('"price_per_video" >=');
    expect(sql).toContain('"price_per_video" <=');
    expect(sql).toContain("'topCountries'");
  });

  it('treats an empty filter as an omitted one', async () => {
    // A GET form submits every field it renders, so this is the common case
    // rather than an edge one — an untouched form arrives exactly like this.
    const response = await handleDiscoverCreators(
      new Request(
        url('?niche=&audience=&price_min=&price_max=&min_engagement=')
      ),
      okDeps([row()])
    );
    expect(response.status).toBe(200);
    expect((await response.json()).creators).toHaveLength(1);
  });

  it('rejects a misspelled filter instead of ignoring it', async () => {
    // Without `.strict()` this returns the entire bookable catalogue with
    // nothing to say the filter was dropped — a wrong answer that looks right.
    const select = vi.fn();
    const response = await handleDiscoverCreators(
      new Request(url('?nich=beauty')),
      {
        requireBrand: async () => BRAND_USER,
        select,
      }
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects an unknown niche rather than matching nothing', async () => {
    const response = await handleDiscoverCreators(
      new Request(url('?niche=underwater-basket-weaving')),
      okDeps()
    );
    expect(response.status).toBe(422);
  });

  it('rejects an unknown market code', async () => {
    const response = await handleDiscoverCreators(
      new Request(url('?audience=ZZ')),
      okDeps()
    );
    expect(response.status).toBe(422);
  });

  it('rejects an inverted price range', async () => {
    // Almost always a swapped pair of inputs. Saying so beats answering with
    // AC-011's "try widening your criteria" to a brand whose criteria are fine.
    const response = await handleDiscoverCreators(
      new Request(url('?price_min=500000&price_max=150000')),
      okDeps()
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.details.priceMin).toBeDefined();
  });

  it('rejects a filter spelled two ways with different values', async () => {
    const select = vi.fn();
    const response = await handleDiscoverCreators(
      new Request(url('?price_min=150000&priceMin=500000')),
      { requireBrand: async () => BRAND_USER, select }
    );

    expect(response.status).toBe(422);
    expect(select).not.toHaveBeenCalled();
  });

  it('answers an over-large limit with 422 rather than a whole-table read', async () => {
    const response = await handleDiscoverCreators(
      new Request(url(`?limit=${MAX_PAGE_SIZE + 1}`)),
      okDeps()
    );
    expect(response.status).toBe(422);
  });
});

// -- The schema -------------------------------------------------------------

describe('discoverCreatorsSchema', () => {
  it('coerces every numeric field out of its query-string form', () => {
    const parsed = discoverCreatorsSchema.parse({
      minEngagement: '4.5',
      priceMin: '150000',
      priceMax: '500000',
      limit: '10',
      offset: '20',
    });
    expect(parsed).toEqual({
      minEngagement: 4.5,
      priceMin: 150_000,
      priceMax: 500_000,
      limit: 10,
      offset: 20,
    });
  });

  it('accepts every niche and every market the form can offer', () => {
    for (const niche of NICHES) {
      expect(discoverCreatorsSchema.safeParse({ niche }).success).toBe(true);
    }
    for (const audience of AUDIENCE_MARKET_CODES) {
      expect(discoverCreatorsSchema.safeParse({ audience }).success).toBe(true);
    }
  });

  it('caps engagement at a real measurement', () => {
    expect(
      discoverCreatorsSchema.safeParse({ minEngagement: MAX_ENGAGEMENT_RATE })
        .success
    ).toBe(true);
    expect(
      discoverCreatorsSchema.safeParse({
        minEngagement: MAX_ENGAGEMENT_RATE + 1,
      }).success
    ).toBe(false);
  });

  it('rejects a fractional price — santim is the smallest unit there is', () => {
    expect(
      discoverCreatorsSchema.safeParse({ priceMin: '150000.5' }).success
    ).toBe(false);
  });

  it('allows an equal price floor and ceiling', () => {
    // One exact tier, which is what picking the same option twice means.
    expect(
      discoverCreatorsSchema.safeParse({ priceMin: 150_000, priceMax: 150_000 })
        .success
    ).toBe(true);
  });
});

// -- Query-string normalisation ---------------------------------------------

describe('readParams', () => {
  const of = (query: string) => new URLSearchParams(query);

  it('drops empty values so an untouched form filter is absent', () => {
    const { params } = readParams(
      of('niche=&price_min='),
      DISCOVERY_PARAM_ALIASES
    );
    expect(params).toEqual({});
  });

  it('folds the snake_case spellings the contract names', () => {
    const { params } = readParams(
      of('min_engagement=4&price_min=1&price_max=2'),
      DISCOVERY_PARAM_ALIASES
    );
    expect(params).toEqual({
      minEngagement: '4',
      priceMin: '1',
      priceMax: '2',
    });
  });

  it('leaves an unaliased key alone so the schema can reject it', () => {
    const { params } = readParams(of('nich=beauty'), DISCOVERY_PARAM_ALIASES);
    expect(params).toEqual({ nich: 'beauty' });
  });

  it('reports one filter given two ways with different values', () => {
    const { conflicts } = readParams(
      of('price_min=1&priceMin=2'),
      DISCOVERY_PARAM_ALIASES
    );
    expect(conflicts).toEqual(['priceMin']);
    expect(conflictDetails(conflicts).priceMin).toHaveLength(1);
  });

  it('does not call the same value twice a conflict', () => {
    const { conflicts } = readParams(
      of('price_min=1&priceMin=1'),
      DISCOVERY_PARAM_ALIASES
    );
    expect(conflicts).toEqual([]);
  });

  it('takes the last value of an ordinary repeated key', () => {
    const { params, conflicts } = readParams(of('niche=a&niche=b'));
    expect(params.niche).toBe('b');
    expect(conflicts).toEqual([]);
  });
});

describe('searchParamsFrom', () => {
  it('reads a Server Component searchParams prop the same way a URL is read', () => {
    // Next hands a page a plain object, not `URLSearchParams`. Rebuilding the
    // real thing is what keeps the page and the endpoint agreeing about what
    // `?niche=` means, rather than each growing its own reading of the URL.
    const search = searchParamsFrom({ niche: 'beauty', audience: undefined });
    expect(search.get('niche')).toBe('beauty');
    expect(search.has('audience')).toBe(false);
  });

  it('takes the last value when Next reports a key as an array', () => {
    expect(searchParamsFrom({ niche: ['a', 'b'] }).get('niche')).toBe('b');
  });
});

// -- AC-011 -----------------------------------------------------------------

describe('the empty state (AC-011)', () => {
  it('rejoins to the acceptance criterion exactly', () => {
    // `EmptyState` takes a title and a description separately, so the criterion
    // has to be split. This is what stops the halves being paraphrased apart.
    expect(`${NO_MATCHES_TITLE} ${NO_MATCHES_DESCRIPTION}`).toBe(
      NO_MATCHES_MESSAGE
    );
    expect(NO_MATCHES_MESSAGE).toBe(
      'No creators match these filters. Try widening your criteria.'
    );
  });

  it('is not retyped on the page', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(brand)/(onboarded)/discover/page.tsx'),
      'utf8'
    );
    expect(source).toContain('NO_MATCHES_TITLE');
    expect(source).not.toContain('No creators match these filters');
  });
});

// -- Source guards ----------------------------------------------------------

describe('the discovery page reads through the query module', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/(brand)/(onboarded)/discover/page.tsx'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('calls readDiscovery rather than selecting creators itself', () => {
    expect(source).toContain('readDiscovery');
    expect(source).not.toContain('creatorProfile');
    expect(source).not.toMatch(/\bfrom\s*\(/);
  });

  it('hand-writes no verified check', () => {
    // The predicate `lib/creators/queries.ts` exists to prevent — the version
    // that quietly forgets the tier half and publishes unpriceable creators.
    expect(source).not.toContain("'verified'");
    expect(source).not.toContain('status');
  });

  it('runs on the Node runtime, because pg needs Node APIs', () => {
    expect(source).toContain("export const runtime = 'nodejs'");
  });
});
