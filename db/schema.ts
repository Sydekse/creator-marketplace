import { sql } from 'drizzle-orm';
import {
  bigserial,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

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

/**
 * A Chapa hosted-checkout attempt to fund one campaign (KAN-70).
 *
 *   initialized → verified → consumed     (the happy path)
 *   initialized → failed | expired        (rejected charge / abandoned)
 *   verified    → failed                  (charge landed but the campaign was
 *                                          no longer fundable — admin case)
 *
 * `verified` means Chapa's verify endpoint confirmed the charge; `consumed`
 * means the escrow ledger has taken the money into holds. Two states rather
 * than one because the money exists at Chapa the moment the charge succeeds,
 * whether or not our funding transaction can run — a session stuck at
 * `verified` is real money awaiting an admin, not a bug to ignore.
 */
export type FundingSessionStatus =
  'initialized' | 'verified' | 'consumed' | 'failed' | 'expired';

/**
 * One wallet withdrawal (KAN-70): `pending` (row written, balance debited) →
 * `processing` (Chapa transfer accepted) → `paid` | `failed`. A failed
 * withdrawal re-credits the wallet by ceasing to count against it — see
 * `lib/wallet` for the balance arithmetic.
 */
export type WithdrawalStatus = 'pending' | 'processing' | 'paid' | 'failed';

/** Where a creator's withdrawals go. Telebirr rides Chapa's bank list too. */
export type PayoutMethodKind = 'bank' | 'telebirr';

/**
 * The external leg of a dispute refund (KAN-70 PR 4): `pending` (row written,
 * about to ask Chapa) → `processing` (Chapa accepted the refund request) →
 * `refunded` (refund webhook confirmed) | `failed` (Chapa said no — retryable
 * from the admin payments view). The internal escrow refund has already
 * committed before this row exists; this table tracks only whether the money
 * made it back onto the brand's card/telebirr.
 */
export type RefundStatus = 'pending' | 'processing' | 'refunded' | 'failed';

/**
 * The state of a hold at the payment processor (KAN-200).
 *
 * Structurally identical to `ProviderStatus['state']` in `lib/payment/types.ts`
 * and deliberately re-declared rather than imported: this file is what
 * drizzle-kit loads, and keeping its imports to drizzle plus `./auth-schema`
 * means generating a migration never depends on the app's path aliases
 * resolving. The two cannot silently drift — `lib/payment/pg-hold-store.ts`
 * assigns a row's `state` straight into a `HoldRecord`, so a divergence is a
 * type error rather than a runtime surprise.
 */
export type ProviderHoldState = 'held' | 'captured' | 'released' | 'failed';

// -- Identity ---------------------------------------------------------------

/**
 * Better Auth owns and manages the `user`, `session`, `account`, and
 * `verification` tables at runtime via the schema in `db/auth-schema.ts`.
 *
 * We re-export `user` here so that every business table in this file can
 * declare foreign-key references to it with a single import from `@/db/schema`.
 *
 * The `role` column (one of brand, creator, admin) is a Better Auth additional
 * field that every server-side RBAC gate reads (FR-001, NFR-005).
 */
export { user };

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
    // Last time follower/engagement numbers were pulled from the TikTok API.
    // Null for email (demo) sign-ups and for TikTok creators whose fetch failed.
    statsRefreshedAt: timestamp('stats_refreshed_at', { withTimezone: true }),
    // Set when refreshed stats suggest a *lower* tier (or no tier) than the
    // current one — tiers never auto-drop; an admin reviews and decides.
    tierReviewAt: timestamp('tier_review_at', { withTimezone: true }),
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

export const campaignItem = pgTable(
  'campaign_item',
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('campaign_item_campaign_creator_unique').on(
      t.campaignId,
      t.creatorId
    ),
    check(
      'campaign_item_total_price_valid',
      sql`${t.totalPrice} = ${t.unitPrice} * ${t.videoCount}`
    ),
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
    // KAN-69 (F40): the disputed/flagged state AC-030 and KAN-53 AC-4
    // presuppose. Deliberately a boolean, not a status: the machine's statuses
    // drive legal transitions and terminal-state guarantees, while a flag is
    // attention metadata an admin raises and a resolution clears — orthogonal
    // to status by design, so it cannot break REFUNDABLE_FROM or AC-9.
    flagged: boolean('flagged').notNull().default(false),
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
    check(
      'deal_total_price_valid',
      sql`${t.totalPrice} = ${t.unitPrice} * ${t.videoCount}`
    ),
    // AC-017: a deal can never be accepted without recording *which* terms were
    // agreed to and *when*. Both columns or neither — a row carrying only one
    // of them is a half-recorded agreement, and the half that is missing is
    // always the half a dispute turns on.
    //
    // The three exempt statuses are the ones an offer can reach without ever
    // being accepted. Everything from `accepted` onward is downstream of an
    // acceptance, so the pair is required there — which makes this structural
    // rather than a property of whichever code path happened to do the write.
    check(
      'deal_rights_accepted_when_accepted',
      sql`${t.status} in ('pending', 'declined', 'expired') or (${t.rightsTermsId} is not null and ${t.rightsAcceptedAt} is not null)`
    ),
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

/**
 * One row per **video**, so a deal delivers every video it was paid for (F38).
 *
 * `deal_id` was `unique` until this migration, which is where the bug lived: a
 * deal priced for three videos could only ever hold one URL, and approving that
 * one released all three videos' money. The tech spec's §4.4 table says "One
 * deliverable per deal" and the PRD's AC-009 ("3 videos from creator A"),
 * AC-026 ("each video shows…") and AC-027 ("that video shows Metrics pending")
 * cannot all be true alongside it. The PRD binds, so the constraint goes and
 * the spec line is amended.
 *
 * **The ceiling is not a CHECK, and could not be.** "At most `video_count`
 * rows" spans two tables, which no per-row CHECK can express. It is enforced in
 * `lib/deals/submit-deliverable.ts`, counting under the `FOR UPDATE` lock the
 * submission already holds on the deal — so two concurrent submissions cannot
 * both see room for the last video. Stated here because an absent constraint is
 * otherwise something the next reader has to discover.
 *
 * `review_status`, `reviewed_at` and `rejection_reason` were always per row, and
 * that is what makes per-video review work without new columns: the brand sends
 * back one video, and only that row carries the note.
 */
export const deliverable = pgTable(
  'deliverable',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
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
    /**
     * Snapshot of the video's cover image, copied into our Vercel Blob store
     * at submit (KAN-46 follow-up). Stored rather than fetched per render
     * because TikTok's oEmbed thumbnail URLs are signed and expire — and the
     * snapshot survives the video being deleted or made private, which is
     * exactly when the brand needs evidence of what was submitted. Null when
     * the best-effort copy failed (no blob token, oEmbed down, …); the UI
     * falls back to the placeholder frame.
     */
    thumbnailUrl: text('thumbnail_url'),
    /**
     * TikTok's numeric video id, resolved from the oEmbed response at submit.
     * Long-form URLs carry it in the path, but `vm.tiktok.com` share links do
     * not — and the in-app player (`tiktok.com/embed/v2/{id}`) needs it. Null
     * when oEmbed could not be reached; the card then falls back to opening
     * TikTok instead of playing inline.
     */
    tiktokVideoId: text('tiktok_video_id'),
  },
  (t) => [
    // Replaces the unique constraint's index. Every read of this table is
    // "the videos for this deal" — both detail views, the dashboard, and the
    // metric-reminder sweep — so the lookup that was free under `unique` has
    // to stay free without it.
    index('deliverable_deal_id_idx').on(t.dealId),
  ]
);

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

/**
 * Append-only history of view counts, one row per metric write (KAN mock v4:
 * "new reach this week"). `video_metric` keeps only the latest totals, so any
 * "how much did reach grow since X" question needs the value as of X — this
 * table is that memory. Written alongside the upsert in
 * `lib/deals/record-metrics.ts`; never updated, never deleted.
 */
export const videoMetricSnapshot = pgTable(
  'video_metric_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => deliverable.id),
    views: integer('views').notNull(),
    likes: integer('likes'),
    shares: integer('shares'),
    comments: integer('comments'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Every read is "this deliverable's views as of a cutoff" — the dashboard
    // resolves one row per deliverable via max(captured_at) <= cutoff.
    index('video_metric_snapshot_deliverable_captured_idx').on(
      t.deliverableId,
      t.capturedAt
    ),
  ]
);

/**
 * Append-only creator profile metric history. `creator_profile` stores the
 * latest follower/engagement numbers; this table remembers the trend each time
 * a TikTok refresh succeeds so the creator dashboard can show growth and tier
 * movement instead of a static profile snapshot.
 */
export const creatorMetricSnapshot = pgTable(
  'creator_metric_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creatorProfile.id),
    followerCount: integer('follower_count').notNull(),
    engagementRate: numeric('engagement_rate', { precision: 5, scale: 2 }),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text('source').notNull().default('tiktok'),
  },
  (t) => [
    index('creator_metric_snapshot_creator_captured_idx').on(
      t.creatorId,
      t.capturedAt
    ),
  ]
);

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
    // KAN-53 (review): monotonic write order. `created_at` is transaction
    // start, so entries written in one transaction share it and `id` is a
    // random uuid — neither can order rows written together. `seq` is the
    // insertion order (bigserial, assigned per row in a multi-row `values`),
    // which is what makes "the last entry" a well-defined question for the
    // reconciliation check on the admin ledger view.
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
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

/**
 * Append-only. Every admin action writes a row with actor and timestamp
 * (AC-031, FR-008).
 *
 * `action` and `target_type` are `text` rather than enums for the reason given
 * at the top of this file, but they are not free-form: the closed vocabulary
 * lives in `lib/audit/actions.ts` and `withAdminAudit` is the only writer.
 *
 * Insert-only is enforced by a trigger (migration 0002) as well as by
 * convention, because "no application code path updates or deletes a row" is a
 * property of code that a future ticket can break by accident, and this table
 * is worthless the moment it can be rewritten.
 */
export const auditLog = pgTable(
  'audit_log',
  {
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
  },
  (t) => [
    // One index per filter the read path offers, each leading with the filtered
    // column and trailing with `created_at` — every query sorts by it, so
    // carrying it in the index is what keeps the sort off the heap.
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_actor_created_idx').on(t.actorId, t.createdAt),
    index('audit_log_action_created_idx').on(t.action, t.createdAt),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ]
);

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    /**
     * When the provider accepted the email (KAN-57 review, F3).
     *
     * Null until dispatch succeeds, and written *after* the transaction
     * commits — so it is delivery bookkeeping, never part of the money path.
     * Its consumer is the metric-reminder idempotency guard: only a
     * *delivered* reminder suppresses the next one, so a dispatch failure
     * (or a crash before flush) leaves the row undelivered and the next run
     * tries again instead of believing a mail the creator never saw.
     */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('notification_user_created_idx').on(t.userId, t.createdAt)]
);

// -- Notification preferences -------------------------------------------------

/**
 * Per-user email opt-outs, one row per user, absent meaning "everything on".
 *
 * Four category booleans rather than a per-type map: thirteen toggles is a
 * chore no one completes, and new notification types get a sensible default by
 * joining a category instead of being silently unmuteable. The in-app feed is
 * deliberately not muteable — these govern *email* dispatch only, so a muted
 * category still writes its `notification` row and shows in the bell.
 */
export const notificationPref = pgTable('notification_pref', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => user.id),
  /** Offers, deliveries, reviews, disputes — the deal lifecycle. */
  emailDeals: boolean('email_deals').notNull().default(true),
  /** Funding and wallet movement. */
  emailMoney: boolean('email_money').notNull().default(true),
  /** Verification results and tier changes. */
  emailAccount: boolean('email_account').notNull().default(true),
  /** Scheduled nudges (metric reminders). */
  emailReminders: boolean('email_reminders').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// -- Chapa payment rails (KAN-70) ---------------------------------------------

/**
 * One brand's trip through Chapa's hosted checkout to fund one campaign.
 *
 * The mock provider funds in-process, synchronously. Chapa funds via redirect:
 * the brand leaves for checkout.chapa.co and the money's arrival is announced
 * asynchronously (webhook, return-page verify, or both — whichever lands
 * first). This row is the state that survives the round trip.
 *
 * `amount` is the santim total the checkout was opened for. The webhook
 * handler verifies Chapa's charge against it exactly — a mismatch quarantines
 * the session (`failed`) rather than funding a campaign with the wrong money.
 */
export const fundingSession = pgTable(
  'funding_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brandProfile.id),
    /**
     * Our merchant reference at Chapa (`cmfund_<uuid>`), single-use. Unique
     * here and unique at Chapa; it is the join between their books and ours.
     */
    txRef: text('tx_ref').notNull().unique(),
    amount: integer('amount').notNull(),
    status: text('status')
      .$type<FundingSessionStatus>()
      .notNull()
      .default('initialized'),
    /** Chapa's hosted checkout URL — kept so "Resume payment" can re-enter it. */
    checkoutUrl: text('checkout_url').notNull(),
    /** Chapa's own reference for the charge, recorded at verification. */
    providerRef: text('provider_ref'),
    failureReason: text('failure_reason'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One open checkout per campaign: resume it or cancel it, never stack a
    // second one that could double-charge the brand.
    uniqueIndex('funding_session_open_unique')
      .on(t.campaignId)
      .where(sql`${t.status} = 'initialized'`),
    index('funding_session_campaign_idx').on(t.campaignId, t.createdAt),
    check('funding_session_amount_positive', sql`${t.amount} > 0`),
  ]
);

/**
 * Where a creator's withdrawals go. One per creator for the MVP (unique on
 * `creator_id`, updated in place) — multiple saved methods are a settings-page
 * problem for later, and a withdrawal snapshots what it used anyway.
 *
 * `bank_code`/`bank_name` come from Chapa's `GET /banks` at save time; the
 * name is a display snapshot so the wallet page never needs the banks API to
 * render.
 */
export const payoutMethod = pgTable('payout_method', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id')
    .notNull()
    .unique()
    .references(() => creatorProfile.id),
  kind: text('kind').$type<PayoutMethodKind>().notNull(),
  bankCode: text('bank_code').notNull(),
  bankName: text('bank_name').notNull(),
  accountNumber: text('account_number').notNull(),
  accountName: text('account_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One wallet withdrawal (KAN-70). This table *is* the wallet's ledger:
 * available balance = Σ `release_payout` ledger entries for the creator's
 * deals − Σ withdrawals here whose status is not `failed`. Pending and
 * processing rows count against the balance — the money is spoken for the
 * moment the row exists, which is what makes a concurrent second withdrawal
 * unable to double-spend.
 *
 * Deliberately NOT new `ledger_entry` types: that table's `balance_after` is
 * a per-campaign escrow running balance, and a creator's wallet spans
 * campaigns. Bolting wallet rows onto it would corrupt the invariant the
 * admin reconciliation view checks.
 *
 * The payout method is snapshotted (kind/bank/masked account/name) so the
 * receipt still says where the money went after the creator changes methods.
 */
export const withdrawal = pgTable(
  'withdrawal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creatorProfile.id),
    amount: integer('amount').notNull(),
    status: text('status')
      .$type<WithdrawalStatus>()
      .notNull()
      .default('pending'),
    /** Our merchant reference at Chapa (`cmwd_<uuid>`), single-use. */
    txRef: text('tx_ref').notNull().unique(),
    /** Chapa's transfer reference, recorded once the transfer is accepted. */
    providerRef: text('provider_ref'),
    methodKind: text('method_kind').$type<PayoutMethodKind>().notNull(),
    bankName: text('bank_name').notNull(),
    /** Last-4 masked at write time — the full number never leaves `payout_method`. */
    accountNumberMasked: text('account_number_masked').notNull(),
    accountName: text('account_name').notNull(),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('withdrawal_creator_created_idx').on(t.creatorId, t.createdAt),
    index('withdrawal_status_created_idx').on(t.status, t.createdAt),
    check('withdrawal_amount_positive', sql`${t.amount} > 0`),
  ]
);

/**
 * The external leg of one deal's dispute refund (KAN-70 PR 4).
 *
 * The escrow ledger's `refund` entry is the book truth and has already
 * committed when this row is written — a failure here never un-refunds the
 * deal internally. What this row tracks is the Chapa partial refund against
 * the original funding charge (`funding_tx_ref`), so the admin payments view
 * can see which refunds actually reached the brand's payment method and retry
 * the ones that did not.
 *
 * One row per deal (unique on `deal_id`): a deal refunds at most once
 * internally (`refunded` is terminal), so retries update this row's status
 * rather than stacking attempts — the row is the reconciliation line.
 */
export const refund = pgTable(
  'refund',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // One refund row per deal — the internal refund is terminal, so the
    // uniqueness is what makes a retry an UPDATE rather than a second row.
    // Declared table-level: the deliverable-table guard test forbids the
    // inline `deal_id`-unique shape schema-wide.
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deal.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    /** The consumed funding session's `cmfund_` reference — what Chapa refunds against. */
    fundingTxRef: text('funding_tx_ref').notNull(),
    amount: integer('amount').notNull(),
    status: text('status').$type<RefundStatus>().notNull().default('pending'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    unique('refund_deal_id_unique').on(t.dealId),
    index('refund_status_created_idx').on(t.status, t.createdAt),
    index('refund_funding_tx_ref_idx').on(t.fundingTxRef),
    check('refund_amount_positive', sql`${t.amount} > 0`),
  ]
);

// -- Mock payment processor -------------------------------------------------

/**
 * Where `MockPaymentProvider` keeps its holds (KAN-200).
 *
 * **This is not part of the data model.** Every other table in this file is ours;
 * this one stands in for storage that belongs to an external payment processor,
 * and it exists only because our processor is a mock (Q3 defers the real one past
 * the MVP). When a real provider arrives this table is dropped, not migrated.
 *
 * It is here because the mock previously kept holds in a module-level `Map`,
 * which does not survive between serverless invocations: the hold placed while
 * funding a campaign was gone by the time the brand approved a deliverable, so
 * `capturePayout` answered `INVALID_REFERENCE` and the brand got
 * "Payment failed — please try again." with no way past it.
 *
 * Nothing here references `deal` or `campaign`, deliberately. A processor knows
 * its own references and its own money; the mapping from a hold to a deal is
 * ours and lives on `ledger_entry.provider_ref` (invariant 12 — one hold per
 * deal, so that column is what joins the two worlds).
 *
 * Not append-only, unlike `ledger_entry`: a hold is drawn down in place, which is
 * what a processor does. Our record of the money moving is the ledger, and that
 * is still insert-only.
 */
export const providerHold = pgTable('provider_hold', {
  /**
   * The processor's own reference — `mock_<uuid>`, minted by `hold()`. The
   * primary key rather than a surrogate id, because it is the only identifier
   * every other provider method is handed.
   */
  providerRef: text('provider_ref').primaryKey(),
  /**
   * What is left to draw, in santim (invariant 4). Named for what it is: both
   * payout legs subtract from it and the hold becomes `captured` at zero
   * (invariant 13), so this is never the amount originally held.
   */
  amountRemaining: integer('amount_remaining').notNull(),
  state: text('state').$type<ProviderHoldState>().notNull(),
  /**
   * No `defaultNow()` on either timestamp. These are the processor's clock, and
   * the provider already stamps them — `getStatus` reports `updatedAt` back to
   * us, so a default would let Postgres and the mock disagree about when a hold
   * moved.
   */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
