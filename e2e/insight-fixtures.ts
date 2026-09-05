import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  dealEvent,
  deliverable,
  deliverableEvent,
  ledgerEntry,
  rightsTerms,
  user,
  videoMetric,
  type DealStatus,
} from '../db/schema';
import type { DeliverableEventKind } from '../lib/deliverables/evidence';

const at = (hours: number) =>
  new Date(Date.UTC(2026, 0, 5) + hours * 3_600_000);

/**
 * Unique creators keep cross-campaign history independent of seeds/other tests.
 * Evidence and money are append-only: dispose of the isolated test database,
 * rather than disabling its triggers to delete fixtures.
 */
export async function createInsightFixtures() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for e2e');
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname))
    throw new Error('Insight fixtures require an isolated local test database');
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);
  try {
    return await db.transaction(async (tx) => {
      const [brand] = await tx
        .select({ id: brandProfile.id, userId: user.id })
        .from(brandProfile)
        .innerJoin(user, eq(user.id, brandProfile.userId))
        .where(eq(user.email, 'brand@demo.com'));
      const [admin] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, 'admin@demo.com'));
      const [terms] = await tx.select().from(rightsTerms).limit(1);
      if (!brand || !admin || !terms)
        throw new Error('Seed the isolated e2e database before browser tests');
      const tag = randomUUID().slice(0, 6);
      const handles = {
        alpha: `alpha_${tag}`,
        beta: `beta_${tag}`,
        gamma: `gamma_${tag}`,
        zero: `zero_${tag}`,
        duplicate: `repeat_${tag}`,
        refunded: `refund_${tag}`,
        legacy: `legacy_${tag}`,
        missing: `missing_${tag}`,
        solo: `solo_${tag}`,
      };
      const creators = {} as Record<keyof typeof handles, string>;
      for (const key of Object.keys(handles) as (keyof typeof handles)[]) {
        const [person] = await tx
          .insert(user)
          .values({
            id: randomUUID(),
            name: handles[key],
            email: `${handles[key]}@insights.example`,
            role: 'creator',
            emailVerified: true,
          })
          .returning();
        const [profile] = await tx
          .insert(creatorProfile)
          .values({
            userId: person.id,
            tiktokHandle: handles[key],
            niche: 'Lifestyle',
            audience: {},
            status: 'verified',
          })
          .returning();
        creators[key] = profile.id;
      }
      async function makeCampaign(
        label: string,
        status: 'draft' | 'confirmed' | 'in_progress' | 'cancelled'
      ) {
        const [row] = await tx
          .insert(campaign)
          .values({
            brandId: brand.id,
            name: `Insights ${label} ${tag}`,
            goal: 'Deterministic recorded cost and collaboration evidence.',
            budget: 200_000,
            desiredVideos: 12,
            status,
          })
          .returning();
        return row.id;
      }
      const draft = await makeCampaign('draft', 'draft');
      const empty = await makeCampaign('unfunded', 'confirmed');
      const populated = await makeCampaign('populated', 'in_progress');
      const solo = await makeCampaign('one creator', 'cancelled');

      async function makeDeal(
        campaignId: string,
        creator: keyof typeof handles,
        status: DealStatus,
        videoCount: number,
        unitPrice: number
      ) {
        const [row] = await tx
          .insert(deal)
          .values({
            campaignId,
            creatorId: creators[creator],
            status,
            videoCount,
            unitPrice,
            totalPrice: unitPrice * videoCount,
            commissionRate: '15.00',
            rightsTermsId: terms.id,
            rightsAcceptedAt: at(0),
          })
          .returning();
        await tx.insert(dealEvent).values({
          dealId: row.id,
          fromStatus: null,
          toStatus: 'pending',
          actorId: brand.userId,
          createdAt: at(-1),
        });
        return row;
      }
      await makeDeal(empty, 'solo', 'accepted', 1, 10_000);
      const soloDeal = await makeDeal(solo, 'solo', 'refunded', 1, 10_000);
      await tx.insert(ledgerEntry).values([
        {
          campaignId: solo,
          dealId: soloDeal.id,
          entryType: 'hold',
          amount: 10_000,
          balanceAfter: 10_000,
        },
        {
          campaignId: solo,
          dealId: soloDeal.id,
          entryType: 'refund',
          amount: -10_000,
          balanceAfter: 0,
        },
      ]);

      const specs = [
        [
          'alpha',
          'completed',
          2,
          10_000,
          [
            [1000, 10],
            [3000, 20],
          ],
        ],
        ['beta', 'completed', 1, 30_000, [[6000, null]]],
        ['gamma', 'completed', 1, 5000, [[null, 50]]],
        ['zero', 'completed', 1, 10_000, [[0, 0]]],
        [
          'duplicate',
          'completed',
          2,
          7000,
          [
            [500, 5],
            [500, 5],
          ],
        ],
        ['refunded', 'refunded', 1, 8000, [[800, 8]]],
        ['legacy', 'completed', 1, 4000, [[2000, 20]]],
        ['missing', 'funded', 2, 9000, [[null, null]]],
      ] as const;
      let balance = 0;
      const dealIds = {} as Record<(typeof specs)[number][0], string>;
      for (const [creator, status, ordered, price, metrics] of specs) {
        const row = await makeDeal(populated, creator, status, ordered, price);
        dealIds[creator] = row.id;
        balance += row.totalPrice;
        await tx.insert(ledgerEntry).values({
          campaignId: populated,
          dealId: row.id,
          entryType: 'hold',
          amount: row.totalPrice,
          balanceAfter: balance,
        });
        if (status !== 'funded') {
          if (status === 'refunded') {
            balance -= row.totalPrice;
            await tx.insert(ledgerEntry).values({
              campaignId: populated,
              dealId: row.id,
              entryType: 'refund',
              amount: -row.totalPrice,
              balanceAfter: balance,
            });
          } else {
            const commission = row.totalPrice * 0.15;
            balance -= row.totalPrice - commission;
            await tx.insert(ledgerEntry).values({
              campaignId: populated,
              dealId: row.id,
              entryType: 'release_payout',
              amount: -(row.totalPrice - commission),
              balanceAfter: balance,
            });
            balance -= commission;
            await tx.insert(ledgerEntry).values({
              campaignId: populated,
              dealId: row.id,
              entryType: 'commission',
              amount: -commission,
              balanceAfter: balance,
            });
          }
        }
        if (creator !== 'legacy') {
          await tx.insert(dealEvent).values({
            dealId: row.id,
            fromStatus: 'accepted',
            toStatus: 'funded',
            createdAt: at(0),
          });
          if (creator !== 'missing')
            await tx.insert(dealEvent).values({
              dealId: row.id,
              fromStatus: 'funded',
              toStatus: 'delivered',
              createdAt: at(2),
            });
        }
        const firstCycle = randomUUID();
        const secondCycle = randomUUID();
        for (const [index, [views, likes]] of metrics.entries()) {
          const legacy = creator === 'legacy';
          const revised = creator === 'alpha' && index === 0;
          const version = legacy ? 0 : revised ? 2 : 1;
          const identity =
            creator === 'duplicate'
              ? '7000000000000000999'
              : `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
          const tiktokUrl = `https://www.tiktok.com/@${handles[creator]}/video/${identity}`;
          const [video] = await tx
            .insert(deliverable)
            .values({
              dealId: row.id,
              tiktokUrl,
              tiktokVideoId: identity,
              videoOrdinal: index + 1,
              submissionVersion: version,
              historyCompleteness: legacy ? 'legacy_baseline' : 'complete',
              reviewStatus: status === 'completed' ? 'approved' : 'pending',
              submittedAt: at(revised ? 5 : 2),
            })
            .returning();
          // Old submission metrics must not leak into the current version.
          await tx.insert(videoMetric).values({
            deliverableId: video.id,
            submissionVersion: creator === 'missing' ? 0 : version,
            views: creator === 'missing' ? 999_999 : views,
            likes,
            comments: creator === 'missing' ? null : 0,
            shares: creator === 'missing' ? null : 0,
            source: creator === 'gamma' ? 'admin' : 'creator',
            stale: creator === 'alpha' && index === 1,
            lastUpdatedAt: at(8),
          });
          async function evidence(
            kind: DeliverableEventKind,
            hours: number,
            submissionVersion: number,
            actorRole: 'creator' | 'brand' | 'admin' | 'system',
            reviewCycleId: string | null = null
          ) {
            await tx.insert(deliverableEvent).values({
              dealId: row.id,
              deliverableId: video.id,
              tiktokUrl,
              kind,
              submissionVersion,
              actorRole,
              actorId:
                actorRole === 'brand'
                  ? brand.userId
                  : actorRole === 'admin'
                    ? admin.id
                    : null,
              occurredAt: at(hours),
              reviewCycleId,
              revisionCategory:
                kind === 'revision_requested' ? 'brief_requirement' : null,
              metadata: legacy ? { reviewStatus: 'approved' } : {},
            });
          }
          if (legacy) {
            await evidence('legacy_baseline', 2, 0, 'system');
            continue;
          }
          await evidence('submitted', 2, 1, 'creator');
          if (creator === 'missing') continue;
          await evidence('review_ready', 2, 1, 'system', firstCycle);
          if (revised) {
            await evidence('revision_requested', 3, 1, 'brand', firstCycle);
            await evidence('submitted', 5, 2, 'creator');
          }
          if (creator === 'alpha') {
            if (!revised)
              await evidence('review_interrupted', 3, 1, 'brand', firstCycle);
            await evidence('review_ready', 5, version, 'system', secondCycle);
          }
          if (status === 'completed')
            await evidence(
              creator === 'gamma' ? 'admin_release' : 'batch_approved',
              creator === 'alpha' ? 7 : 4,
              version,
              creator === 'gamma' ? 'admin' : 'brand',
              creator === 'alpha' ? secondCycle : firstCycle
            );
          else await evidence('refunded', 4, version, 'admin');
        }
      }
      return { draft, empty, populated, solo, handles, dealIds };
    });
  } finally {
    await pool.end();
  }
}

export type InsightFixtures = Awaited<ReturnType<typeof createInsightFixtures>>;
