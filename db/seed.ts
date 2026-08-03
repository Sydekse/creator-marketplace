import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';
import {
  COMMISSION_RATE,
  PRICING_TIERS,
  RIGHTS_TERMS,
} from '../lib/config/pricing';
import {
  brandProfile,
  creatorProfile,
  pricingTier,
  rightsTerms,
  user,
} from './schema';

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

type DemoUser = {
  email: string;
  name: string;
  role: 'admin' | 'brand' | 'creator';
};

const DEMO_USERS = [
  { email: 'admin@demo.com', name: 'Admin User', role: 'admin' },
  { email: 'brand@demo.com', name: 'Brand User', role: 'brand' },
  { email: 'creator@demo.com', name: 'Verified Creator', role: 'creator' },
  {
    email: 'creator.pending@demo.com',
    name: 'Pending Creator',
    role: 'creator',
  },
] as const satisfies readonly DemoUser[];

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

  for (const spec of DEMO_USERS) {
    const userId = await ensureUser(db, auth, spec);

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

    if (spec.role === 'creator') {
      const isVerified = spec.email === 'creator@demo.com';

      await db
        .insert(creatorProfile)
        .values({
          userId,
          // Unique per AC-003, so the second creator needs its own handle.
          tiktokHandle: isVerified ? '@demo_creator' : '@demo_creator_pending',
          niche: isVerified ? 'lifestyle' : 'fitness',
          audience: { topCountries: ['ET', 'US', 'KE'], ageRange: '18-34' },
          followerCount: isVerified ? 25_000 : 8_000,
          engagementRate: isVerified ? '3.50' : '2.10',
          // AC5 wants one of each so the admin verification queue (KAN-22) has
          // something to show and discovery (KAN-24) has something to return.
          status: isVerified ? 'verified' : 'pending_verification',
          verifiedAt: isVerified ? new Date() : null,
          // Left null deliberately. A creator is bookable only when verified
          // *and* tiered (AC-006), and assigning the tier is KAN-23's job — the
          // admin doing it by hand is the flow that ticket exists to prove.
          tierId: null,
        })
        .onConflictDoNothing();
    }

    console.log(`    ${spec.role.padEnd(7)} ${spec.email}`);
  }

  console.log('  Done.');
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
