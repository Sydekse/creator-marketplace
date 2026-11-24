import {
  checkedSum,
  prepareInsightDeals,
  summarizeInsightDeals,
  type InsightDealInput,
} from '@/lib/campaigns/insight-model';
import type { CampaignSettlement } from '@/lib/payment/escrow';

export function groupInsightRecords<T>(
  rows: readonly T[],
  key: (row: T) => string
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = result.get(id);
    if (bucket) bucket.push(row);
    else result.set(id, [row]);
  }
  return result;
}

/** Repeated joins may repeat records, never choose between conflicting evidence. */
export function distinctInsightRecords<T>(
  rows: readonly T[],
  key: (row: T) => string
): T[] {
  const result = new Map<string, T>();
  const fingerprints = new Map<string, string>();
  for (const row of rows) {
    const id = key(row);
    const fingerprint = JSON.stringify(row, (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
          )
        : value
    );
    if (fingerprints.has(id) && fingerprints.get(id) !== fingerprint)
      throw new Error('Conflicting insight records');
    if (!result.has(id)) {
      result.set(id, row);
      fingerprints.set(id, fingerprint);
    }
  }
  return [...result.values()];
}

export const EMPTY_SETTLEMENT: CampaignSettlement = {
  paidOut: 0,
  commission: 0,
  refunded: 0,
};

export function calculateBrandPerformance(
  inputs: readonly (InsightDealInput & { campaignId: string })[],
  campaignIds: readonly string[],
  settlements: ReadonlyMap<string, CampaignSettlement>
) {
  const selected = new Set(campaignIds);
  const distinct = distinctInsightRecords(
    inputs
      .filter((input) => selected.has(input.campaignId))
      .map((input) => ({
        ...input,
        videos: distinctInsightRecords(input.videos, (video) => video.id),
      })),
    (input) => input.id
  );
  const videoOwners = new Map<string, string>();
  for (const input of distinct) {
    for (const video of input.videos) {
      if (videoOwners.has(video.id) && videoOwners.get(video.id) !== input.id)
        throw new Error('Conflicting insight video ownership');
      videoOwners.set(video.id, input.id);
    }
  }
  const prepared = prepareInsightDeals(distinct);
  const campaignsByDeal = new Map(
    distinct.map((input) => [input.id, input.campaignId])
  );
  const grouped = groupInsightRecords(prepared, (input) =>
    campaignsByDeal.get(input.id)!
  );
  const scopedSettlements = [...selected].map(
    (id) => settlements.get(id) ?? EMPTY_SETTLEMENT
  );
  const settlement = {
    paidOut: checkedSum(scopedSettlements.map((row) => row.paidOut)),
    commission: checkedSum(scopedSettlements.map((row) => row.commission)),
    refunded: checkedSum(scopedSettlements.map((row) => row.refunded)),
  };
  return {
    overall: summarizeInsightDeals(prepared, settlement),
    campaigns: new Map(
      [...selected].map((id) => [
        id,
        summarizeInsightDeals(
          grouped.get(id) ?? [],
          settlements.get(id) ?? EMPTY_SETTLEMENT
        ),
      ])
    ),
  };
}
