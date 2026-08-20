import { and, eq, not } from 'drizzle-orm';
import { db as defaultDb } from '@/db';
import { campaign, deal } from '@/db/schema';

/**
 * KAN-99 §5 — campaign lifecycle: advance a funded campaign to `completed`
 * when every deal has reached `completed`.
 *
 * Called after each deal approval as a best-effort follow-up. The payout and
 * deal status are already final; this is purely a campaign-level bookkeeping
 * advance. Failure is swallowed — a campaign that stays "Funded" when it
 * should be "Completed" is a cosmetic issue, not a money or correctness one.
 */
export interface AdvanceCompletionDeps {
  db: typeof defaultDb;
}

const defaultDeps: AdvanceCompletionDeps = { db: defaultDb };

export async function advanceCampaignIfComplete(
  campaignId: string,
  deps: AdvanceCompletionDeps = defaultDeps
): Promise<void> {
  // Check if any deal in this campaign is NOT completed.
  // If none exist, every deal is completed and the campaign can advance.
  const [incomplete] = await deps.db
    .select({ id: deal.id })
    .from(deal)
    .where(
      and(eq(deal.campaignId, campaignId), not(eq(deal.status, 'completed')))
    )
    .limit(1);

  if (incomplete) return; // At least one deal is not completed yet.

  // Confirm there is at least one deal (an empty campaign cannot be "completed").
  const [anyDeal] = await deps.db
    .select({ id: deal.id })
    .from(deal)
    .where(eq(deal.campaignId, campaignId))
    .limit(1);

  if (!anyDeal) return;

  // All deals are completed — advance the campaign.
  await deps.db
    .update(campaign)
    .set({ status: 'completed' })
    .where(eq(campaign.id, campaignId));
}
