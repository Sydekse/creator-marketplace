import { loadEnvConfig } from '@next/env';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  AgeRange,
  AudienceMarketCode,
  Niche,
} from '../lib/config/creator-profile';
import {
  COMMISSION_RATE,
  PRICING_TIERS,
  RIGHTS_TERMS,
  offerExpiresAt as computeOfferExpiry,
} from '../lib/config/pricing';
import { selectTier } from '../lib/creators/tier-assignment';
import { formatEtb } from '../lib/money';
import { getPaymentProvider } from '../lib/payment';
import { EscrowLedgerService } from '../lib/payment/ledger';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  dealEvent,
  pricingTier,
  rightsTerms,
  user,
} from './schema';
import type { DealStatus } from './schema';

// `tsx db/seed.ts` runs outside the Next.js runtime, so `.env.local` is not
// loaded for us — same reason `drizzle.config.ts` does this.
//
// It has to happen before `db/index.ts` is evaluated, because that module builds
// its connection pool from `process.env.DATABASE_URL` at import time. Static
// imports are hoisted above this call, hence the dynamic imports inside `main()`.
loadEnvConfig(process.cwd());

/**
 * Demo account password. Overridable so a shared preview environment does not
 * have to use the value published in this file.
 *
 * These accounts exist to make the demo loop walkable end to end. They are not
 * test fixtures and they are not for production — see the guard in `main()`.
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-Passw0rd!';

/**
 * A demo creator's profile row.
 *
 * Carried on the spec rather than derived from the email, which is what the
 * first two demo creators did (`isVerified = spec.email === 'creator@demo.com'`)
 * and what stopped working the moment there were more than two of them.
 *
 * No tier is named here. The tier comes from `selectTier` against the rows
 * seeded above, so these numbers describe a creator and the ladder decides what
 * that is worth (invariant 8) — a hardcoded 'Micro' would be a second, silent
 * definition of the bands that goes stale the moment Q2 moves them.
 */
type CreatorSeed = {
  tiktokHandle: string;
  niche: Niche;
  /** Market codes for the `audience` jsonb's `topCountries` (AC-010). */
  topCountries: readonly AudienceMarketCode[];
  /**
   * `'18-34'` on the two original rows only: it predates `AGE_RANGES` and the
   * note in `lib/config/creator-profile.ts` describes why it is harmless. New
   * rows use the real vocabulary rather than spreading the quirk.
   */
  ageRange: AgeRange | '18-34';
  followerCount: number;
  /** Percentage string, matching `creator_profile.engagement_rate`. */
  engagementRate: string;
  status: 'verified' | 'pending_verification';
};

type DemoUser = {
  email: string;
  name: string;
  role: 'admin' | 'brand' | 'creator';
  creator?: CreatorSeed;
};

/**
 * The demo roster.
 *
 * The creators exist so a filter can be told apart from a bug. With one
 * bookable creator — which is what this seed had before KAN-28 — every filter
 * looks like it works and every broken filter looks like it works too, because
 * a single row either survives or it does not. So the set below is spread
 * deliberately: seven bookable creators across three tiers, six niches and five
 * markets, giving each AC-010 filter both something to match and something to
 * exclude, and making AC-011's empty state reachable by *filtering* rather than
 * by an empty database.
 *
 * Two of them are the reason discovery has a rule at all. `@demo_creator_pending`
 * is verified by nobody, and `@demo_creator_untiered` is verified but falls
 * below every band — so it is the row that proves AC-006's second half, the one
 * a `status = 'verified'` query written by hand would wrongly return.
 */
// Annotated rather than `as const satisfies`: the literal types that produced
// would give the admin and brand entries no `creator` property at all, so the
// loop below could not ask whether one is there. Nothing here needs an email to
// be a literal type — the old `spec.email === 'creator@demo.com'` test is what
// this restructure removed.
const DEMO_USERS: readonly DemoUser[] = [
  { email: 'admin@demo.com', name: 'Admin User', role: 'admin' },
  { email: 'brand@demo.com', name: 'Brand User', role: 'brand' },
  {
    email: 'creator@demo.com',
    name: 'Verified Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_creator',
      niche: 'lifestyle',
      topCountries: ['ET', 'US', 'KE'],
      ageRange: '18-34',
      followerCount: 25_000,
      engagementRate: '3.50',
      status: 'verified',
    },
  },
  {
    email: 'creator.pending@demo.com',
    name: 'Pending Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_creator_pending',
      niche: 'fitness',
      topCountries: ['ET', 'US', 'KE'],
      ageRange: '18-34',
      followerCount: 8_000,
      engagementRate: '2.10',
      // AC5 of KAN-19 wants one of each, so the admin verification queue
      // (KAN-22) has something to show.
      status: 'pending_verification',
    },
  },
  {
    email: 'creator.untiered@demo.com',
    name: 'Untiered Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_creator_untiered',
      niche: 'gaming',
      topCountries: ['ET'],
      ageRange: '18-24',
      // Below the lowest band's follower floor, so `selectTier` returns
      // `no_matching_tier` and the row stays un-tiered — verified and still
      // invisible to a brand (AC-006).
      followerCount: 4_200,
      engagementRate: '2.80',
      status: 'verified',
    },
  },
  {
    email: 'creator.beauty@demo.com',
    name: 'Beauty Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_beauty',
      niche: 'beauty',
      topCountries: ['ET'],
      ageRange: '18-24',
      followerCount: 14_500,
      engagementRate: '3.10',
      status: 'verified',
    },
  },
  {
    email: 'creator.beauty.mid@demo.com',
    name: 'Beauty Creator (Mid)',
    role: 'creator',
    creator: {
      // A second creator on the same niche as the one above but a higher band,
      // so `?niche=beauty&price_max=` narrows from two rows to one. Two filters
      // that each match on their own is the only way to see AND working.
      tiktokHandle: '@demo_beauty_mid',
      niche: 'beauty',
      topCountries: ['ET', 'AE'],
      ageRange: '25-34',
      followerCount: 82_000,
      engagementRate: '4.80',
      status: 'verified',
    },
  },
  {
    email: 'creator.comedy@demo.com',
    name: 'Comedy Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_comedy',
      niche: 'comedy',
      topCountries: ['ET', 'KE', 'SO'],
      ageRange: '18-24',
      followerCount: 64_000,
      engagementRate: '6.20',
      status: 'verified',
    },
  },
  {
    email: 'creator.fashion@demo.com',
    name: 'Fashion Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_fashion',
      niche: 'fashion',
      topCountries: ['ET', 'KE'],
      ageRange: '25-34',
      followerCount: 31_000,
      engagementRate: '3.90',
      status: 'verified',
    },
  },
  {
    email: 'creator.tech@demo.com',
    name: 'Tech Creator',
    role: 'creator',
    creator: {
      tiktokHandle: '@demo_tech',
      niche: 'tech',
      topCountries: ['ET', 'US', 'GB'],
      ageRange: '25-34',
      followerCount: 310_000,
      engagementRate: '5.60',
      status: 'verified',
    },
  },
  {
    email: 'creator.travel@demo.com',
    name: 'Travel Creator',
    role: 'creator',
    creator: {
      // The only bookable creator with no Ethiopian audience, so `?audience=ET`
      // has something to leave out.
      tiktokHandle: '@demo_travel',
      niche: 'travel',
      topCountries: ['US', 'GB', 'AE'],
      ageRange: '35-44',
      followerCount: 420_000,
      engagementRate: '5.10',
      status: 'verified',
    },
  },
] satisfies readonly DemoUser[];

/**
 * One demo deal, described by where it ends up rather than how it gets there.
 *
 * The deal state machine (KAN-34) and the routes that drive it do not exist
 * yet, so this seed walks each deal to its target itself. Money-moving steps go
 * through `EscrowLedgerService` — never a hand-written `ledger_entry` — so the
 * balances a creator reads on the dashboard are computed by the same code that
 * will compute them in production, under the NFR-009 100%-coverage mandate.
 * Non-money transitions are written directly, each with its `deal_event`
 * (invariant 6): a seed that skipped the event would manufacture rows that
 * violate an invariant later code relies on.
 */
type DemoDealSpec = {
  campaignName: string;
  goal: string;
  videoCount: number;
  target: DealStatus;
  /** KAN-69 (F40): raise the attention flag, so the disputed worklist has one. */
  flagged?: boolean;
};

/**
 * Demo campaigns, one deal each, covering all five dashboard groups (AC-2).
 *
 * One campaign per deal, which looks redundant and is not: `holdForCampaign`
 * funds *every* accepted deal in a campaign at once, and `deal` is unique on
 * `(campaign_id, creator_id)`. So a single creator cannot hold two deals in one
 * campaign, and two deals in one campaign cannot be at different points on the
 * money path. A creator working with several brands is the realistic shape
 * anyway.
 *
 * `revision_requested` is deliberately absent. Reaching it needs a deliverable
 * to reject (KAN-46/47), and faking one would put a `deliverable` row in the
 * database that no deliverable code has ever seen. The group it belongs to is
 * covered by the two deals above it.
 */
const DEMO_DEALS: readonly DemoDealSpec[] = [
  {
    campaignName: 'Ramadan Beauty Push',
    goal: 'Drive awareness for the seasonal gift set.',
    videoCount: 2,
    target: 'pending',
  },
  {
    campaignName: 'Coffee Launch',
    goal: 'Introduce the single-origin line to Addis.',
    videoCount: 1,
    target: 'accepted',
  },
  {
    campaignName: 'Tech Review Series',
    goal: 'Hands-on reviews of the new handset range.',
    videoCount: 3,
    target: 'funded',
  },
  {
    campaignName: 'Fitness January',
    goal: 'Sign-ups for the new-year membership offer.',
    videoCount: 2,
    target: 'delivered',
    // Flagged so the disputed worklist has a row (KAN-69 F40). No integration
    // suite touches it — those self-create their own fixtures, because the
    // mock provider's holds are per-process and a seeded hold would be
    // invisible to the test process.
    flagged: true,
  },
  {
    campaignName: 'Summer Kickoff',
    goal: 'Launch the warm-weather campaign block.',
    videoCount: 2,
    target: 'delivered',
    // The e2e worklist fixture (KAN-60 flow 6, KAN-78): delivered, money
    // held, flagged, so the admin worklist shows it for the dispute walk.
    // Integration suites self-create fixtures and never touch seeded deals.
    flagged: true,
  },
  {
    campaignName: 'Holiday Fashion',
    goal: 'Style the winter capsule collection.',
    videoCount: 2,
    target: 'completed',
  },
  {
    campaignName: 'Campus Tour',
    goal: 'Student ambassador content across three universities.',
    videoCount: 4,
    target: 'declined',
  },
  {
    campaignName: 'Cancelled Pilot',
    goal: 'Pilot that the brand pulled after funding.',
    videoCount: 1,
    target: 'refunded',
  },
];

async function main() {
  const { db } = await import('./index');
  const { auth } = await import('../lib/auth');

  console.log('Seeding database …');

  // -- Pricing tiers -------------------------------------------------------
  //
  // Values come from `lib/config/pricing.ts`, not from literals here (AC2), so
  // that resolving Q2 is a one-file change and nothing drifts out of sync.
  console.log('  Pricing tiers …');

  await db
    .insert(pricingTier)
    .values(PRICING_TIERS.map((t) => ({ ...t })))
    .onConflictDoNothing();

  // Read back rather than reuse `PRICING_TIERS` — the ids are generated by
  // Postgres, and on a re-run `onConflictDoNothing` means the rows already there
  // are the ones creators must be pointed at.
  const seededTiers = await db
    .select({
      id: pricingTier.id,
      name: pricingTier.name,
      pricePerVideo: pricingTier.pricePerVideo,
      minFollowers: pricingTier.minFollowers,
      minEngagement: pricingTier.minEngagement,
      active: pricingTier.active,
    })
    .from(pricingTier);

  // -- Commission rate -----------------------------------------------------
  //
  // AC3. There is no config/settings table in the schema — by design, since
  // `deal.commission_rate` is snapshotted per deal at offer time (invariant 8)
  // and never read back from a global at payout time. So the configured rate
  // has no row to live in: `lib/config/pricing.ts` *is* the seeded source, and
  // KAN-33 imports it when it writes the snapshot.
  //
  // Echoed here so a seed run shows the rate the environment will offer at.
  console.log(`  Commission rate … ${COMMISSION_RATE}%`);

  // -- Rights terms --------------------------------------------------------
  //
  // Placeholder body pending Q5. Real terms arrive as a *new* version row, not
  // an edit to this one — see the note in the config module.
  console.log(`  Rights terms … ${RIGHTS_TERMS.version}`);

  await db
    .insert(rightsTerms)
    .values({
      version: RIGHTS_TERMS.version,
      body: RIGHTS_TERMS.body,
      effectiveAt: RIGHTS_TERMS.effectiveAt,
    })
    .onConflictDoNothing();

  // -- Demo users ----------------------------------------------------------
  //
  // Accounts whose password is written in the repo must never exist in
  // production. Tiers and rights terms above are safe anywhere; this block is
  // not, so it is gated rather than the whole script.
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.SEED_ALLOW_DEMO_USERS
  ) {
    console.log('  Demo users … skipped (NODE_ENV=production)');
    console.log('  Done.');
    return;
  }

  console.log('  Demo users …');

  // Collected as the loop goes, because the deal block below needs the brand's
  // and the creator's ids and `ensureUser` is the only thing that knows them.
  const userIdByEmail = new Map<string, string>();

  for (const spec of DEMO_USERS) {
    const userId = await ensureUser(db, auth, spec);
    userIdByEmail.set(spec.email, userId);

    // Applied every run, not just on creation, so a half-seeded database heals
    // instead of staying wrong.
    //
    // The role is written directly rather than passed to sign-up: the
    // `user.create.before` hook in `lib/auth.ts` allowlists brand and creator
    // only, so 'admin' cannot be self-assigned through the API (NFR-005). That
    // hook is the control being respected here, not worked around — its own
    // comment nominates this path, "an admin promoting someone writes the
    // column directly".
    //
    // `emailVerified` is set so the demo accounts can sign in without a mail
    // round-trip.
    await db
      .update(user)
      .set({ role: spec.role, emailVerified: true })
      .where(eq(user.id, userId));

    if (spec.role === 'brand') {
      await db
        .insert(brandProfile)
        .values({ userId, companyName: 'Demo Brand Co.' })
        .onConflictDoNothing();
    }

    if (spec.creator) {
      const seed = spec.creator;
      const verified = seed.status === 'verified';

      // A verified creator has to be *bookable* to reach discovery, which means
      // tiered as well as verified (AC-006).
      //
      // Run through `selectTier` against the rows just seeded rather than named
      // outright — see `CreatorSeed`. An unverified creator is never tiered,
      // matching what activation does; `@demo_creator_untiered` is verified and
      // still gets no tier, because the ladder says so.
      const outcome = verified
        ? selectTier(seededTiers, {
            followerCount: seed.followerCount,
            engagementRate: seed.engagementRate,
          })
        : null;

      await db
        .insert(creatorProfile)
        .values({
          userId,
          // Unique per AC-003, so every creator needs its own handle.
          tiktokHandle: seed.tiktokHandle,
          niche: seed.niche,
          audience: {
            topCountries: [...seed.topCountries],
            ageRange: seed.ageRange,
          },
          followerCount: seed.followerCount,
          engagementRate: seed.engagementRate,
          status: seed.status,
          verifiedAt: verified ? new Date() : null,
          tierId: outcome?.assigned ? outcome.tierId : null,
        })
        .onConflictDoNothing();

      // Fills in a tier the insert above could not, and only that.
      //
      // `onConflictDoNothing` means a creator seeded before tier assignment
      // existed (KAN-23) keeps whatever they had, which for `@demo_creator` is
      // `tier_id = null` — verified, unbookable, and invisible to discovery on
      // any database that was seeded even once before Wave 6. The insert reports
      // a tier it never wrote, so the seed's own output says the demo works
      // while `/discover` shows it does not.
      //
      // Guarded on `IS NULL` rather than written unconditionally: this fills a
      // gap, it does not re-tier anybody. Moving a creator who already has a
      // band is an admin decision (AC-004) and re-running a seed is not the
      // place to make it — see the Q2 reseed note in FOLLOWUPS.
      if (outcome?.assigned) {
        await db
          .update(creatorProfile)
          .set({ tierId: outcome.tierId })
          .where(
            and(
              eq(creatorProfile.userId, userId),
              isNull(creatorProfile.tierId)
            )
          );
      }

      // Read back rather than reported from `outcome`, because the two can
      // disagree: everything above is conditional on what was already there, so
      // printing the computed verdict describes a database that may not exist.
      // A seed that overstates what it did is worse than one that does less.
      const [stored] = await db
        .select({
          status: creatorProfile.status,
          tierId: creatorProfile.tierId,
        })
        .from(creatorProfile)
        .where(eq(creatorProfile.userId, userId))
        .limit(1);

      const storedTier = seededTiers.find((t) => t.id === stored?.tierId);
      const tier = storedTier
        ? `${storedTier.name} ${formatEtb(storedTier.pricePerVideo)}`
        : `no tier${outcome && !outcome.assigned ? ` (${outcome.reason})` : ''}`;
      console.log(
        `    creator ${spec.email.padEnd(28)} ${seed.tiktokHandle.padEnd(24)} ${(stored?.status ?? '?').padEnd(21)} ${tier}`
      );
    } else {
      console.log(`    ${spec.role.padEnd(7)} ${spec.email}`);
    }
  }

  await seedDemoDeals(db, userIdByEmail);

  console.log('  Done.');
}

/**
 * Demo campaigns and deals for `creator@demo.com`, so the creator dashboard has
 * something to show before Waves 9–12 build the routes that write these rows
 * (KAN-33 offers, KAN-43 funding, KAN-45 payout).
 *
 * Every figure the dashboard displays is therefore produced by real code:
 * `unit_price` comes off the creator's assigned tier row, `commission_rate`
 * from `lib/config/pricing.ts` (invariant 8 — no literals here), and the ledger
 * entries and `balance_after` values from `EscrowLedgerService`. Nothing in
 * this function writes a `ledger_entry` itself, which is what makes the two
 * earnings totals on screen the numbers the ledger would really produce.
 */
async function seedDemoDeals(
  db: (typeof import('./index'))['db'],
  userIdByEmail: Map<string, string>
) {
  const brandUserId = userIdByEmail.get('brand@demo.com');
  const creatorUserId = userIdByEmail.get('creator@demo.com');
  if (!brandUserId || !creatorUserId) return;

  const [brand] = await db
    .select({ id: brandProfile.id })
    .from(brandProfile)
    .where(eq(brandProfile.userId, brandUserId))
    .limit(1);

  // The tier is joined rather than assumed: `unit_price` is a snapshot of what
  // this creator is actually priced at, so a demo deal cannot quote a number no
  // brand would have been charged.
  const [creator] = await db
    .select({
      id: creatorProfile.id,
      tierId: creatorProfile.tierId,
      pricePerVideo: pricingTier.pricePerVideo,
    })
    .from(creatorProfile)
    .innerJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
    .where(eq(creatorProfile.userId, creatorUserId))
    .limit(1);

  const [terms] = await db
    .select({ id: rightsTerms.id })
    .from(rightsTerms)
    .where(eq(rightsTerms.version, RIGHTS_TERMS.version))
    .limit(1);

  if (!brand || !creator || !terms) {
    console.log(
      '  Demo deals … skipped (brand, tiered creator or terms missing)'
    );
    return;
  }

  // Idempotency, as one check rather than seven.
  //
  // `holdForCampaign` throws "Campaign has already been funded" on a second
  // call, so this block cannot be replayed halfway — a per-campaign
  // `onConflictDoNothing` would leave the inserts idempotent and the money
  // steps not. Any campaign for this brand means the block has run.
  const [existing] = await db
    .select({ id: campaign.id })
    .from(campaign)
    .where(eq(campaign.brandId, brand.id))
    .limit(1);

  if (existing) {
    console.log('  Demo deals … already seeded');
    return;
  }

  console.log('  Demo deals …');

  const ledger = new EscrowLedgerService(db, getPaymentProvider());
  const offerExpiresAt = computeOfferExpiry();

  for (const spec of DEMO_DEALS) {
    const totalPrice = creator.pricePerVideo * spec.videoCount;

    const [row] = await db
      .insert(campaign)
      .values({
        brandId: brand.id,
        name: spec.campaignName,
        goal: spec.goal,
        // Covers the deal exactly. A budget below the committed total would be
        // a state AC-014's ceiling is supposed to make unreachable.
        budget: totalPrice,
        desiredVideos: spec.videoCount,
        // Every one of these has an offer out, which is past draft. The three
        // that get funded are moved to 'funded' by `holdForCampaign` itself.
        status: 'confirmed',
      })
      .returning({ id: campaign.id });

    const [created] = await db
      .insert(deal)
      .values({
        campaignId: row.id,
        creatorId: creator.id,
        videoCount: spec.videoCount,
        // Snapshots, not lookups (invariant 8): re-pricing a tier later must
        // not retroactively change what an offered deal pays out.
        unitPrice: creator.pricePerVideo,
        totalPrice,
        commissionRate: COMMISSION_RATE,
        rightsTermsId: terms.id,
        offerExpiresAt,
        ...(spec.flagged ? { flagged: true } : {}),
      })
      .returning({ id: deal.id });

    await walkDealTo(db, ledger, {
      dealId: created.id,
      campaignId: row.id,
      target: spec.target,
      brandUserId,
      creatorUserId,
    });

    console.log(
      `    ${spec.campaignName.padEnd(22)} ${spec.target.padEnd(10)} ${String(spec.videoCount).padStart(2)} × ${formatEtb(creator.pricePerVideo)} = ${formatEtb(totalPrice)}`
    );
  }
}

/**
 * A status update plus its `deal_event`, in that order and never one without
 * the other (invariant 6, FR-007). Stands in for transitions whose real
 * handlers are later tickets — decline (KAN-37), deliver (KAN-46) — and does
 * not touch money.
 *
 * `also` carries any column that must land in the *same* UPDATE as the status.
 * That is not a convenience: `deal_rights_accepted_when_accepted` rejects a row
 * at `accepted` with null rights columns, so stamping them in a second
 * statement fails at the first one. The real action (`lib/deals/accept-offer.ts`)
 * writes both inside one transaction for the same reason, and the seed should
 * not model a sequence the database forbids.
 */
async function transitionDemoDeal(
  db: (typeof import('./index'))['db'],
  dealId: string,
  from: DealStatus,
  to: DealStatus,
  actorId: string,
  reason: string,
  also?: Partial<typeof deal.$inferInsert>
) {
  await db
    .update(deal)
    .set({ status: to, ...also })
    .where(eq(deal.id, dealId));
  await db.insert(dealEvent).values({
    dealId,
    fromStatus: from,
    toStatus: to,
    actorId,
    reason,
  });
}

/**
 * Drives one freshly-inserted `pending` deal to its target status.
 *
 * The cases fall through deliberately: `completed` is `delivered` plus a
 * payout, and `delivered` is `funded` plus a submission, so writing them as a
 * cascade keeps the seed's path through the machine the same one the real
 * routes will take. Anything the ledger owns goes through the ledger.
 */
async function walkDealTo(
  db: (typeof import('./index'))['db'],
  ledger: EscrowLedgerService,
  opts: {
    dealId: string;
    campaignId: string;
    target: DealStatus;
    brandUserId: string;
    creatorUserId: string;
  }
) {
  const { dealId, campaignId, target, brandUserId, creatorUserId } = opts;

  if (target === 'pending') return;

  if (target === 'declined') {
    await transitionDemoDeal(
      db,
      dealId,
      'pending',
      'declined',
      creatorUserId,
      'Creator declined the offer'
    );
    return;
  }

  // Everything below is accepted first — rights are accepted with the offer
  // (AC-016, AC-017), so the timestamp lands in the same write as the status.
  // One statement, not two: the CHECK constraint refuses the intermediate row
  // where the status has moved and the rights columns have not.
  //
  // `rights_terms_id` is already on the row from the insert above, so only the
  // timestamp is added here. The real action re-derives the id from the server's
  // own current-terms read instead of trusting either.
  await transitionDemoDeal(
    db,
    dealId,
    'pending',
    'accepted',
    creatorUserId,
    'Creator accepted the offer',
    { rightsAcceptedAt: new Date() }
  );

  if (target === 'accepted') return;

  // Money from here down. `holdForCampaign` moves the deal to 'funded', the
  // campaign to 'funded', and writes the `hold` entry and its `deal_event`.
  await ledger.holdForCampaign(campaignId, brandUserId);

  if (target === 'funded') return;

  if (target === 'refunded') {
    await ledger.refundDeal(dealId, brandUserId);
    return;
  }

  await transitionDemoDeal(
    db,
    dealId,
    'funded',
    'delivered',
    creatorUserId,
    // The same sentence the real action records — `SUBMIT_DELIVERABLE_EVENT_REASON`
    // in `lib/deals/submit-deliverable.ts` (KAN-46) — so a demo deal's history
    // reads exactly like a production one's.
    'Creator submitted the live TikTok post URL'
  );

  if (target === 'delivered') return;

  // 'completed' — releases payout and commission against the hold above.
  await ledger.payoutForDeal(dealId, brandUserId);
}

/**
 * Returns the id of the demo user, creating it through Better Auth if it is not
 * already there.
 *
 * Sign-up goes through `auth.api.signUpEmail` rather than a direct insert
 * because credentials do not live on `user` — Better Auth keeps the hash in
 * `account.password` (`db/auth-schema.ts`). A hand-inserted `user` row has no
 * `account` row, so it exists but cannot sign in, which for a demo account
 * defeats the point. Going through the API also means the hash format stays
 * whatever the library expects, including after an upgrade.
 *
 * The pre-check is what makes this idempotent: `signUpEmail` throws on a
 * duplicate email rather than no-opping, so `onConflictDoNothing()` has no
 * equivalent here.
 */
async function ensureUser(
  db: (typeof import('./index'))['db'],
  auth: (typeof import('../lib/auth'))['auth'],
  spec: DemoUser
): Promise<string> {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, spec.email))
    .limit(1);

  if (existing) return existing.id;

  const result = await auth.api.signUpEmail({
    body: {
      email: spec.email,
      password: DEMO_PASSWORD,
      name: spec.name,
      // Sign-up only ever gets a self-registerable role; admin is promoted
      // afterwards by the direct column write in `main()`.
      role: spec.role === 'admin' ? 'creator' : spec.role,
    },
  });

  return result.user.id;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
