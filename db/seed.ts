import { db } from './index';
import {
  pricingTier,
  rightsTerms,
  user,
  brandProfile,
  creatorProfile,
} from './schema';

async function main() {
  console.log('Seeding database …');

  // -- Pricing tiers -------------------------------------------------------
  console.log('  Pricing tiers …');

  const tiers = [
    {
      name: 'Nano',
      pricePerVideo: 500,
      minFollowers: 0,
      minEngagement: '2.00',
      active: true,
    },
    {
      name: 'Micro',
      pricePerVideo: 1_500,
      minFollowers: 10_000,
      minEngagement: '3.00',
      active: true,
    },
    {
      name: 'Mid',
      pricePerVideo: 5_000,
      minFollowers: 50_000,
      minEngagement: '4.00',
      active: true,
    },
    {
      name: 'Macro',
      pricePerVideo: 15_000,
      minFollowers: 200_000,
      minEngagement: '5.00',
      active: true,
    },
    {
      name: 'Mega',
      pricePerVideo: 40_000,
      minFollowers: 1_000_000,
      minEngagement: '6.00',
      active: true,
    },
  ] satisfies (typeof pricingTier.$inferInsert)[];

  await db.insert(pricingTier).values(tiers).onConflictDoNothing();

  // -- Rights terms --------------------------------------------------------
  console.log('  Rights terms …');

  await db
    .insert(rightsTerms)
    .values({
      version: '1.0',
      body: `By accepting this offer, you grant the brand a worldwide, non-exclusive license to use the delivered content for marketing purposes across digital channels for 12 months from delivery. Creator retains ownership of the original content.`,
      effectiveAt: new Date('2026-07-01'),
    })
    .onConflictDoNothing();

  // -- Demo users ----------------------------------------------------------
  console.log('  Demo users …');

  const demoUsers = [
    {
      email: 'admin@demo.com',
      name: 'Admin User',
      role: 'admin' as const,
      emailVerified: true,
    },
    {
      email: 'brand@demo.com',
      name: 'Brand User',
      role: 'brand' as const,
      emailVerified: true,
    },
    {
      email: 'creator@demo.com',
      name: 'Creator User',
      role: 'creator' as const,
      emailVerified: true,
    },
  ] satisfies (typeof user.$inferInsert)[];

  for (const u of demoUsers) {
    const [inserted] = await db
      .insert(user)
      .values(u)
      .onConflictDoNothing()
      .returning();

    if (!inserted) continue;

    if (u.role === 'brand') {
      await db
        .insert(brandProfile)
        .values({
          userId: inserted.id,
          companyName: 'Demo Brand Co.',
        })
        .onConflictDoNothing();
    }

    if (u.role === 'creator') {
      await db
        .insert(creatorProfile)
        .values({
          userId: inserted.id,
          tiktokHandle: '@demo_creator',
          niche: 'lifestyle',
          audience: { topCountries: ['ET', 'US', 'KE'], ageRange: '18-34' },
          followerCount: 25_000,
          engagementRate: '3.50',
          status: 'verified',
          verifiedAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }

  console.log('  Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
