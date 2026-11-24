import { and, asc, eq, inArray } from 'drizzle-orm';
import { punctualityAggregate } from '@/lib/deals/deadline';
import { db } from '@/db';
import {
  campaign,
  creatorProfile,
  deal,
  dealEvent,
  deliverable,
  deliverableEvent,
  videoMetric,
} from '@/db/schema';
import { ForbiddenError, guard } from '@/lib/authz';
import { UUID_REGEX } from '@/lib/validation';
import { sumSettledByCampaign } from '@/lib/payment/escrow';
import { COMMITS_BUDGET } from './budget';
import { calculateCampaignInsights } from './insight-model';
import {
  calculateCollaborationHistory,
  type CollaborationDealInput,
} from './insight-history';

export async function readCampaignInsights(
  campaignId: string,
  requireAccess = guard
) {
  if (!UUID_REGEX.test(campaignId))
    throw new ForbiddenError('Campaign unavailable');
  const ctx = await requireAccess({
    roles: ['brand'],
    resource: { kind: 'campaign', id: campaignId },
  });
  if (!ctx.brandProfileId) throw new ForbiddenError('Campaign unavailable');
  const brandId = ctx.brandProfileId;
  return db.transaction(
    async (tx) => {
      const [owned] = await tx
        .select({ id: campaign.id })
        .from(campaign)
        .where(and(eq(campaign.id, campaignId), eq(campaign.brandId, brandId)));
      if (!owned) throw new ForbiddenError('Campaign unavailable');
      const selectedCreators = tx
        .select({ id: deal.creatorId })
        .from(deal)
        .innerJoin(campaign, eq(campaign.id, deal.campaignId))
        .where(and(eq(campaign.id, campaignId), eq(campaign.brandId, brandId)));
      const rows = await tx
        .select({ deal, handle: creatorProfile.tiktokHandle })
        .from(deal)
        .innerJoin(campaign, eq(campaign.id, deal.campaignId))
        .innerJoin(creatorProfile, eq(creatorProfile.id, deal.creatorId))
        .where(
          and(
            eq(campaign.brandId, brandId),
            inArray(deal.creatorId, selectedCreators)
          )
        )
        .orderBy(asc(deal.id));
      const ids = rows.map((r) => r.deal.id);
      const scope = and(eq(campaign.brandId, brandId), inArray(deal.id, ids));
      const videos = await (ids.length
        ? tx
            .select({ video: deliverable, metric: videoMetric })
            .from(deliverable)
            .innerJoin(deal, eq(deal.id, deliverable.dealId))
            .innerJoin(campaign, eq(campaign.id, deal.campaignId))
            .leftJoin(
              videoMetric,
              and(
                eq(videoMetric.deliverableId, deliverable.id),
                eq(
                  videoMetric.submissionVersion,
                  deliverable.submissionVersion
                ),
                eq(campaign.id, campaignId)
              )
            )
            .where(scope)
            .orderBy(asc(deliverable.videoOrdinal))
        : Promise.resolve([]));
      const statuses = await (ids.length
        ? tx
            .select({ event: dealEvent })
            .from(dealEvent)
            .innerJoin(deal, eq(deal.id, dealEvent.dealId))
            .innerJoin(campaign, eq(campaign.id, deal.campaignId))
            .where(scope)
            .orderBy(asc(dealEvent.createdAt), asc(dealEvent.id))
        : Promise.resolve([]));
      const evidence = await (ids.length
        ? tx
            .select({ event: deliverableEvent })
            .from(deliverableEvent)
            .innerJoin(deal, eq(deal.id, deliverableEvent.dealId))
            .innerJoin(campaign, eq(campaign.id, deal.campaignId))
            .where(scope)
            .orderBy(asc(deliverableEvent.seq))
        : Promise.resolve([]));
      const settlement = await sumSettledByCampaign(campaignId, tx, brandId);
      const grouped = <T>(values: T[], key: (value: T) => string) => {
        const map = new Map<string, T[]>();
        for (const value of values) {
          const id = key(value);
          const bucket = map.get(id);
          if (bucket) bucket.push(value);
          else map.set(id, [value]);
        }
        return map;
      };
      const byDeal = grouped(videos, (r) => r.video.dealId);
      const statusByDeal = grouped(statuses, (r) => r.event.dealId);
      const byVideo = grouped(evidence, (r) => r.event.deliverableId);
      const now = new Date().toISOString();
      const history: CollaborationDealInput[] = rows.map(({ deal: d }) => ({
        deadline: d,
        id: d.id,
        creatorId: d.creatorId,
        status: d.status,
        rightsAcceptedAt: d.rightsAcceptedAt?.toISOString() ?? null,
        events: (statusByDeal.get(d.id) ?? []).map(({ event }) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
        videos: (byDeal.get(d.id) ?? []).map(({ video }) => ({
          id: video.id,
          historyCompleteness: video.historyCompleteness,
          events: (byVideo.get(video.id) ?? []).map(({ event }) => ({
            ...event,
            occurredAt: event.occurredAt.toISOString(),
          })),
        })),
      }));
      return {
        asOf: now,
        punctuality: punctualityAggregate(
          rows
            .filter((r) => r.deal.campaignId === campaignId)
            .map((r) => r.deal),
          new Date(now)
        ),
        campaign: calculateCampaignInsights(
          rows
            .filter((r) => r.deal.campaignId === campaignId)
            .map(({ deal: d, handle }) => ({
              id: d.id,
              creatorId: d.creatorId,
              creatorHandle: handle,
              status: d.status,
              unitPrice: d.unitPrice,
              totalPrice: d.totalPrice,
              videoCount: d.videoCount,
              commitsBudget: COMMITS_BUDGET[d.status],
              videos: (byDeal.get(d.id) ?? []).map(
                ({ video: v, metric: m }) => ({
                  id: v.id,
                  ordinal: v.videoOrdinal,
                  url: v.tiktokUrl,
                  tiktokVideoId: v.tiktokVideoId,
                  source: m?.source ?? null,
                  updatedAt: m?.lastUpdatedAt?.toISOString() ?? null,
                  stale: m?.stale ?? false,
                  views: m?.views ?? null,
                  likes: m?.likes ?? null,
                  comments: m?.comments ?? null,
                  shares: m?.shares ?? null,
                })
              ),
            })),
          settlement
        ),
        history: calculateCollaborationHistory(history, now),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  );
}

export type CampaignInsights = Awaited<ReturnType<typeof readCampaignInsights>>;
