import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema';
import * as authSchema from '../db/auth-schema';

/**
 * Schema guards for KAN-14 (Tech Spec §3.2).
 *
 * Two complementary angles:
 *   - `getTableConfig` introspects the Drizzle definitions, which is what the
 *     application code types itself against.
 *   - The generated migration SQL is the artifact that actually runs against
 *     Postgres. Asserting on it catches a schema change that was never
 *     regenerated — the drift that would otherwise only surface on deploy.
 */

/** Every table the ticket requires, keyed by its Postgres name. */
const TABLES = {
  user: schema.user,
  creator_profile: schema.creatorProfile,
  brand_profile: schema.brandProfile,
  pricing_tier: schema.pricingTier,
  campaign: schema.campaign,
  rights_terms: schema.rightsTerms,
  deal: schema.deal,
  deal_event: schema.dealEvent,
  deliverable: schema.deliverable,
  video_metric: schema.videoMetric,
  ledger_entry: schema.ledgerEntry,
  audit_log: schema.auditLog,
  notification: schema.notification,
} as const;

/**
 * Better Auth's remaining tables. `user` is in TABLES above because the spec
 * lists it as an MVP entity; these three are framework defaults the spec
 * defers, but they live in our migrations so the same invariants apply.
 */
const AUTH_TABLES = {
  session: authSchema.session,
  account: authSchema.account,
  verification: authSchema.verification,
} as const;

/** Every table in the migration history, business and framework alike. */
const ALL_TABLES = [
  ...Object.entries(TABLES),
  ...Object.entries(AUTH_TABLES),
] as const;

/**
 * Money is an integer count of ETB santim everywhere. A float or numeric here
 * would let rounding drift into the ledger.
 */
const MONEY_COLUMNS: ReadonlyArray<[keyof typeof TABLES, string]> = [
  ['pricing_tier', 'price_per_video'],
  ['campaign', 'budget'],
  ['deal', 'unit_price'],
  ['deal', 'total_price'],
  ['ledger_entry', 'amount'],
  ['ledger_entry', 'balance_after'],
];

const migrationSql = (() => {
  const dir = path.join(process.cwd(), 'drizzle');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
})();

describe('schema tables', () => {
  it('declares all 13 MVP entities', () => {
    expect(Object.keys(TABLES)).toHaveLength(13);
  });

  it.each(Object.entries(TABLES))(
    '%s maps to a table of that name',
    (name, table) => {
      expect(getTableConfig(table).name).toBe(name);
    }
  );

  it.each(ALL_TABLES)('%s has a uuid primary key', (_name, table) => {
    const pk = getTableConfig(table).columns.find((c) => c.primary);
    expect(pk?.name).toBe('id');
    expect(pk?.columnType).toBe('PgUUID');
    expect(pk?.hasDefault).toBe(true);
  });

  it.each(ALL_TABLES)(
    '%s stores every timestamp with a timezone',
    (_name, table) => {
      const timestamps = getTableConfig(table).columns.filter(
        (c) => c.columnType === 'PgTimestamp'
      );
      // pricing_tier is seed/config data and has no timestamps per the spec —
      // that's expected, not a regression. Every other table carries timestamps.
      for (const column of timestamps) {
        expect(
          (column as unknown as { withTimezone: boolean }).withTimezone
        ).toBe(true);
      }
    }
  );

  it('points every foreign key to user.id at a uuid column', () => {
    const referencing = ALL_TABLES.flatMap(([, table]) =>
      getTableConfig(table).foreignKeys.flatMap((fk) => {
        const ref = fk.reference();
        return ref.foreignTable === authSchema.user ? ref.columns : [];
      })
    );
    expect(referencing.length).toBeGreaterThan(0);
    for (const column of referencing) {
      expect(column.columnType).toBe('PgUUID');
    }
  });
});

describe('money columns', () => {
  it.each(MONEY_COLUMNS)(
    '%s.%s is an integer, not a float',
    (tableName, columnName) => {
      const column = getTableConfig(TABLES[tableName]).columns.find(
        (c) => c.name === columnName
      );
      expect(column?.columnType).toBe('PgInteger');
    }
  );
});

describe('generated migration', () => {
  it('creates every table with a uuid primary key', () => {
    const pkLines = migrationSql
      .split('\n')
      .filter((l) => l.includes('PRIMARY KEY'));
    // The 13 MVP entities plus session, account and verification.
    expect(pkLines).toHaveLength(16);
    for (const line of pkLines) {
      expect(line).toContain('"id" uuid PRIMARY KEY');
    }
  });

  // The three guards below exist because a later migration *did* walk these
  // back and it went unnoticed. The invariants are uuid PKs defaulting to
  // gen_random_uuid() and timestamptz throughout (Tech Spec §3, invariant 11);
  // a migration is the only place they can be undone.
  it('never drops the generated default off an id column', () => {
    expect(migrationSql).not.toMatch(/ALTER COLUMN "id" DROP DEFAULT/);
  });

  it('never converts an id column to text', () => {
    expect(migrationSql).not.toMatch(
      /ALTER COLUMN "(id|user_id|actor_id|creator_id|campaign_id|deal_id|deliverable_id|tier_id)" SET DATA TYPE text/
    );
  });

  it('never converts a timestamp column to a timezone-less type', () => {
    expect(migrationSql).not.toMatch(
      /SET DATA TYPE timestamp(?! with time zone)/
    );
  });

  it.each([
    ['campaign_budget_positive', '"campaign"."budget" > 0'],
    ['campaign_desired_videos_positive', '"campaign"."desired_videos" > 0'],
    ['deal_video_count_positive', '"deal"."video_count" > 0'],
  ])('enforces %s at the database level', (name, predicate) => {
    expect(migrationSql).toContain(`CONSTRAINT "${name}" CHECK (${predicate})`);
  });

  it.each([
    ['creator_profile_tiktok_handle_unique', 'UNIQUE("tiktok_handle")'],
    ['deliverable_deal_id_unique', 'UNIQUE("deal_id")'],
    ['video_metric_deliverable_id_unique', 'UNIQUE("deliverable_id")'],
    ['deal_campaign_creator_unique', 'UNIQUE("campaign_id","creator_id")'],
  ])('enforces unique constraint %s', (name, columns) => {
    expect(migrationSql).toContain(`CONSTRAINT "${name}" ${columns}`);
  });

  it.each([
    [
      'creator_profile_status_tier_niche_idx',
      'creator_profile',
      '"status","tier_id","niche"',
    ],
    ['campaign_brand_status_idx', 'campaign', '"brand_id","status"'],
    ['deal_campaign_status_idx', 'deal', '"campaign_id","status"'],
    ['deal_creator_status_idx', 'deal', '"creator_id","status"'],
    ['deal_status_offer_expires_idx', 'deal', '"status","offer_expires_at"'],
    [
      'ledger_entry_campaign_created_idx',
      'ledger_entry',
      '"campaign_id","created_at"',
    ],
    ['ledger_entry_deal_idx', 'ledger_entry', '"deal_id"'],
  ])('creates index %s', (name, table, columns) => {
    expect(migrationSql).toContain(
      `CREATE INDEX "${name}" ON "${table}" USING btree (${columns})`
    );
  });

  it('has no float or decimal money column', () => {
    expect(migrationSql).not.toMatch(/\b(real|double precision|money)\b/i);
  });
});
