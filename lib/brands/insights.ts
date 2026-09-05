import { and, asc, eq, inArray } from 'drizzle-orm';
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
import { COMMITS_BUDGET } from '@/lib/campaigns/budget';
import {
  calculateCollaborationHistory,
  type CollaborationDealInput,
} from '@/lib/campaigns/insight-history';
import { sumSettledByCampaigns } from '@/lib/payment/escrow';
import {
  DEFAULT_INSIGHT_FILTERS,
  InsightSelectionError,
  parseInsightFilters,
  selectInsightCampaigns,
  type InsightFilters,
} from './insight-filters';
import {
  calculateBrandPerformance,
  distinctInsightRecords,
  groupInsightRecords,
} from './insight-model';

export { InsightSelectionError } from './insight-filters';

async function loadBrandInsights(
  filters: InsightFilters,
  withHistory: boolean,
  requireAccess: typeof guard
) {
  const ctx = await requireAccess({ roles: ['brand'] });
  if (!ctx.brandProfileId)
    throw new ForbiddenError('Brand insights unavailable');
  const brandId = ctx.brandProfileId;
  const parsed = parseInsightFilters({
    campaign: filters.campaignIds,
    status: filters.status ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    sort: filters.sort,
    metric: filters.metric,
    campaignPage: String(filters.campaignPage),
    creatorPage: String(filters.creatorPage),
    waitingPage: String(filters.waitingPage),
  });
  if (!parsed.ok) throw new InsightSelectionError();
  const validated = parsed.value;
  return db.transaction(
    async (tx) => {
      const asOf = new Date().toISOString();
      const options = distinctInsightRecords(
        await tx
          .select({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            createdAt: campaign.createdAt,
            goal: campaign.goal,
          })
          .from(campaign)
          .where(eq(campaign.brandId, brandId))
          .orderBy(asc(campaign.id)),
        (row) => row.id
      ).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
      const selected = selectInsightCampaigns(options, validated);
      const ids = selected.map((row) => row.id);
      const scope = and(
        eq(campaign.brandId, brandId),
        inArray(campaign.id, ids)
      );
      const rows = distinctInsightRecords(
        ids.length
          ? await tx
              .select({ deal, handle: creatorProfile.tiktokHandle })
              .from(deal)
              .innerJoin(campaign, eq(campaign.id, deal.campaignId))
              .innerJoin(creatorProfile, eq(creatorProfile.id, deal.creatorId))
              .where(scope)
              .orderBy(asc(deal.id))
          : [],
        (row) => row.deal.id
      );
      const videos = distinctInsightRecords(
        rows.length
          ? await tx
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
                  )
                )
              )
              .where(scope)
              .orderBy(asc(deliverable.videoOrdinal))
          : [],
        (row) => row.video.id
      );
      const statuses = distinctInsightRecords(
        withHistory && rows.length
          ? await tx
              .select({ event: dealEvent })
              .from(dealEvent)
              .innerJoin(deal, eq(deal.id, dealEvent.dealId))
              .innerJoin(campaign, eq(campaign.id, deal.campaignId))
              .where(scope)
              .orderBy(asc(dealEvent.createdAt), asc(dealEvent.id))
          : [],
        (row) => row.event.id
      );
      const evidence = distinctInsightRecords(
        withHistory && rows.length
          ? await tx
              .select({ event: deliverableEvent })
              .from(deliverableEvent)
              .innerJoin(
                deliverable,
                and(
                  eq(deliverable.id, deliverableEvent.deliverableId),
                  eq(deliverable.dealId, deliverableEvent.dealId)
                )
              )
              .innerJoin(deal, eq(deal.id, deliverable.dealId))
              .innerJoin(campaign, eq(campaign.id, deal.campaignId))
              .where(scope)
              .orderBy(asc(deliverableEvent.seq))
          : [],
        (row) => row.event.id
      );
      const settlements = await sumSettledByCampaigns(ids, brandId, tx);
      const byDeal = groupInsightRecords(videos, (row) => row.video.dealId);
      const performance = calculateBrandPerformance(
        rows.map(({ deal: d, handle }) => ({
          campaignId: d.campaignId,
          id: d.id,
          creatorId: d.creatorId,
          creatorHandle: handle,
          status: d.status,
          unitPrice: d.unitPrice,
          totalPrice: d.totalPrice,
          videoCount: d.videoCount,
          commitsBudget: COMMITS_BUDGET[d.status],
          videos: (byDeal.get(d.id) ?? []).map(({ video: v, metric: m }) => ({
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
          })),
        })),
        ids,
        settlements
      );
      const statusByDeal = groupInsightRecords(
        statuses,
        (row) => row.event.dealId
      );
      const byVideo = groupInsightRecords(
        evidence,
        (row) => row.event.deliverableId
      );
      const historyInputs: (CollaborationDealInput & { campaignId: string })[] =
        withHistory
          ? rows.map(({ deal: d }) => ({
              campaignId: d.campaignId,
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
            }))
          : [];
      return {
        asOf,
        filters: validated,
        options,
        selected,
        performance,
        historyInputs,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  );
}

export async function readBrandInsights(
  filters: InsightFilters,
  requireAccess = guard
) {
  const loaded = await loadBrandInsights(filters, true, requireAccess);
  const historyByCampaign = groupInsightRecords(
    loaded.historyInputs,
    (row) => row.campaignId
  );
  return {
    asOf: loaded.asOf,
    filters: loaded.filters,
    options: loaded.options.map(({ id, name, status, createdAt }) => ({
      id,
      name,
      status,
      createdAt,
    })),
    overall: loaded.performance.overall,
    history: calculateCollaborationHistory(loaded.historyInputs, loaded.asOf),
    campaigns: loaded.selected.map((row) => ({
      ...row,
      metrics: loaded.performance.campaigns.get(row.id)!,
      history: calculateCollaborationHistory(
        historyByCampaign.get(row.id) ?? [],
        loaded.asOf
      ).aggregate,
    })),
  };
}

export async function readBrandInsightSummary(requireAccess = guard) {
  const loaded = await loadBrandInsights(
    DEFAULT_INSIGHT_FILTERS,
    false,
    requireAccess
  );
  return {
    asOf: loaded.asOf,
    campaignCount: loaded.selected.length,
    creatorCount: loaded.performance.overall.creators.length,
    overall: loaded.performance.overall,
  };
}

export type BrandInsights = Awaited<ReturnType<typeof readBrandInsights>>;
export type BrandInsightSummary = Awaited<
  ReturnType<typeof readBrandInsightSummary>
>;
