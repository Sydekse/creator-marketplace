import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, campaignItem } from '@/db/schema';
import type { CampaignStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { getCartRunningTotal } from './cart-queries';

export type RemoveFromCartResult =
  | { ok: true; runningTotal: number; remainingBudget: number }
  | { ok: false; reason: 'not_found' | 'not_draft' | 'item_not_found' };

export interface RemoveFromCartDeps {
  getCampaign: (
    tx: Tx,
    campaignId: string,
    brandProfileId: string
  ) => Promise<{
    id: string;
    budget: number;
    status: CampaignStatus;
  } | null>;
  deleteItem: (
    tx: Tx,
    campaignId: string,
    creatorId: string
  ) => Promise<{ id: string }[]>;
  getRunningTotal: (tx: Tx, campaignId: string) => Promise<number>;
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

const defaultDeps: RemoveFromCartDeps = {
  getCampaign: async (tx, campaignId, brandProfileId) => {
    const [row] = await tx
      .select({
        id: campaign.id,
        budget: campaign.budget,
        status: campaign.status,
      })
      .from(campaign)
      .where(
        and(eq(campaign.id, campaignId), eq(campaign.brandId, brandProfileId))
      )
      .for('update')
      .limit(1);

    return row ?? null;
  },
  deleteItem: async (tx, campaignId, creatorId) => {
    return tx
      .delete(campaignItem)
      .where(
        and(
          eq(campaignItem.campaignId, campaignId),
          eq(campaignItem.creatorId, creatorId)
        )
      )
      .returning({ id: campaignItem.id });
  },
  getRunningTotal: (tx, campaignId) => getCartRunningTotal(campaignId, tx),
  transaction: (fn) => db.transaction(fn),
};

export async function removeFromCart(
  campaignId: string,
  brandProfileId: string,
  creatorId: string,
  deps: RemoveFromCartDeps = defaultDeps
): Promise<RemoveFromCartResult> {
  return deps.transaction(async (tx) => {
    const camp = await deps.getCampaign(tx, campaignId, brandProfileId);
    if (!camp) {
      return { ok: false, reason: 'not_found' };
    }

    if (camp.status !== 'draft') {
      return { ok: false, reason: 'not_draft' };
    }

    const deleted = await deps.deleteItem(tx, campaignId, creatorId);
    if (deleted.length === 0) {
      return { ok: false, reason: 'item_not_found' };
    }

    const runningTotal = await deps.getRunningTotal(tx, campaignId);

    return {
      ok: true,
      runningTotal,
      remainingBudget: camp.budget - runningTotal,
    };
  });
}
