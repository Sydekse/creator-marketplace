import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Data model for the Creator Marketplace MVP — Tech Spec §3.2.
 *
 * Conventions that hold for every table below:
 *   - Primary keys are uuid, defaulted by Postgres via gen_random_uuid().
 *   - Timestamps are timestamptz, stored in UTC.
 *   - Money is an integer count of ETB santim (1 ETB = 100). Never float or
 *     numeric — ledger math must not drift. `numeric` appears only for rates
 *     (percentages), which are not money.
 *   - Status columns are `text` with a TypeScript union via `$type`, not
 *     Postgres enums: the app owns the state machine, and widening an enum in
 *     Postgres needs a migration where widening a union does not.
 */

// -- Status unions ----------------------------------------------------------
// Exported so the deal state machine and every later ticket share one source
// of truth rather than re-declaring string literals.

export type UserRole = 'brand' | 'creator' | 'admin';

export type CreatorStatus = 'pending_verification' | 'verified' | 'rejected';

export type CampaignStatus =
  'draft' | 'confirmed' | 'funded' | 'in_progress' | 'completed' | 'cancelled';

export type DealStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'funded'
  | 'delivered'
  | 'revision_requested'
  | 'completed'
  | 'refunded';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type LedgerEntryType =
  'hold' | 'release_payout' | 'commission' | 'refund';

export type MetricSource = 'creator' | 'admin';

// -- Identity ---------------------------------------------------------------

/**
 * Better Auth owns this table at runtime; `role` is our extension and is what
 * every server-side RBAC gate reads (FR-001, NFR-005).
 *
 * Better Auth's own `session`, `account`, and `verification` tables are
 * deliberately not declared here — the spec defers them as framework defaults,
 * and they land with the Better Auth wiring ticket.
 */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  role: text('role').$type<UserRole>().notNull().default('creator'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// -- Pricing ----------------------------------------------------------------

/**
 * Seed/config data, not code. Bands and prices are open question Q2 — rows are
 * inserted by a seed, so changing a price never means changing a constant.
 */
export const pricingTier = pgTable('pricing_tier', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  pricePerVideo: integer('price_per_video').notNull(),
  minFollowers: integer('min_followers').notNull(),
  minEngagement: numeric('min_engagement', { precision: 5, scale: 2 }),
  active: boolean('active').notNull().default(true),
});

// -- Profiles ---------------------------------------------------------------

/**
 * A creator is *bookable* only when status = 'verified' AND tier_id is not null
 * (AC-006). Both halves are columns here; the discovery query enforces the pair.
 */
export const creatorProfile = pgTable(
  'creator_profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => user.id),
    // Unique because one TikTok account may back only one profile (AC-003).
    tiktokHandle: text('tiktok_handle').notNull().unique(),
    niche: text('niche').notNull(),
    audience: jsonb('audience').notNull(),
    followerCount: integer('follower_count'),
    engagementRate: numeric('engagement_rate', { precision: 5, scale: 2 }),
    tierId: uuid('tier_id').references(() => pricingTier.id),
    status: text('status')
      .$type<CreatorStatus>()
      .notNull()
      .default('pending_verification'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Covers the discovery grid's filter combination (AC-010).
    index('creator_profile_status_tier_niche_idx').on(
      t.status,
      t.tierId,
      t.niche
    ),
  ]
);

export const brandProfile = pgTable('brand_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => user.id),
  companyName: text('company_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// -- Campaigns --------------------------------------------------------------

export const campaign = pgTable(
  'campaign',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brandProfile.id),
    name: text('name').notNull(),
    goal: text('goal'),
    targetAudience: jsonb('target_audience'),
    budget: integer('budget').notNull(),
    desiredVideos: integer('desired_videos').notNull(),
    status: text('status').$type<CampaignStatus>().notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('campaign_brand_status_idx').on(t.brandId, t.status),
    // Last line of defence behind the server-side guard (AC-008).
    check('campaign_budget_positive', sql`${t.budget} > 0`),
    check('campaign_desired_videos_positive', sql`${t.desiredVideos} > 0`),
  ]
);

/**
 * Versioned usage-rights text (Q5). The body is placeholder-friendly, but the
 * version string is not optional — a deal records *which* version was accepted.
 */
export const rightsTerms = pgTable('rights_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull().unique(),
  body: text('body').notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
});

// -- Deals ------------------------------------------------------------------

/**
 * `unit_price` and `commission_rate` are snapshots taken at offer time, not
 * lookups. Re-pricing a tier or changing the platform commission later must not
 * retroactively change what an already-offered deal pays out (Q1, Q2).
 */
export const deal = pgTable(
  'deal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creatorProfile.id),
    videoCount: integer('video_count').notNull(),
    unitPrice: integer('unit_price').notNull(),
    totalPrice: integer('total_price').notNull(),
    commissionRate: numeric('commission_rate', {
      precision: 5,
      scale: 2,
    }).notNull(),
    status: text('status').$type<DealStatus>().notNull().default('pending'),
    rightsTermsId: uuid('rights_terms_id').references(() => rightsTerms.id),
    rightsAcceptedAt: timestamp('rights_accepted_at', { withTimezone: true }),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('deal_campaign_status_idx').on(t.campaignId, t.status),
    index('deal_creator_status_idx').on(t.creatorId, t.status),
    // Drives the cron expiry sweep, which scans pending offers by deadline.
    index('deal_status_offer_expires_idx').on(t.status, t.offerExpiresAt),
    // One deal per creator per campaign.
    unique('deal_campaign_creator_unique').on(t.campaignId, t.creatorId),
    check('deal_video_count_positive', sql`${t.videoCount} > 0`),
  ]
);

/**
 * Append-only. Every deal transition writes a row as it happens (FR-007,
 * NFR-012) — this table is the audit trail for the state machine, so rows are
 * inserted and never updated or deleted.
 */
export const dealEvent = pgTable('deal_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deal.id),
  fromStatus: text('from_status').$type<DealStatus>(),
  toStatus: text('to_status').$type<DealStatus>().notNull(),
  // Null means the system acted rather than a person — e.g. the expiry sweep.
  actorId: uuid('actor_id').references(() => user.id),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// -- Delivery and metrics ---------------------------------------------------

export const deliverable = pgTable('deliverable', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Unique: one deliverable per deal.
  dealId: uuid('deal_id')
    .notNull()
    .unique()
    .references(() => deal.id),
  tiktokUrl: text('tiktok_url').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewStatus: text('review_status')
    .$type<ReviewStatus>()
    .notNull()
    .default('pending'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
});

/**
 * Counts are nullable on purpose: null means "not measured yet", which the UI
 * renders as "Metrics pending" rather than zeros (AC-027). A zero here is a
 * real, recorded zero.
 */
export const videoMetric = pgTable('video_metric', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliverableId: uuid('deliverable_id')
    .notNull()
    .unique()
    .references(() => deliverable.id),
  views: integer('views'),
  likes: integer('likes'),
  shares: integer('shares'),
  comments: integer('comments'),
  source: text('source').$type<MetricSource>().notNull().default('creator'),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }),
  stale: boolean('stale').notNull().default(false),
});

// -- Money ------------------------------------------------------------------

/**
 * Append-only internal escrow (FR-004, NFR-003). Written only inside a DB
 * transaction tied to a legal deal transition.
 *
 * `amount` is signed: positive moves money into escrow, negative moves it out.
 * `balance_after` is the campaign's running held balance, which the escrow
 * service guards against going negative in-transaction — Postgres cannot
 * express "sum of prior rows" as a check constraint.
 */
export const ledgerEntry = pgTable(
  'ledger_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    // Null for campaign-level funding, which predates any individual deal.
    dealId: uuid('deal_id').references(() => deal.id),
    entryType: text('entry_type').$type<LedgerEntryType>().notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    providerRef: text('provider_ref'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('ledger_entry_campaign_created_idx').on(t.campaignId, t.createdAt),
    index('ledger_entry_deal_idx').on(t.dealId),
  ]
);

// -- Admin and notifications ------------------------------------------------

/** Append-only. Every admin action writes a row with actor and timestamp (AC-031). */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => user.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notification = pgTable('notification', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
