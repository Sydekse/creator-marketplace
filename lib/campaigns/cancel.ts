import { eq } from 'drizzle-orm';
import { db as defaultDb } from '@/db';
import { campaign } from '@/db/schema';
import { guard as defaultGuard } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';

/**
 * KAN-99 §5 — campaign lifecycle: cancel a draft or confirmed campaign.
 *
 * Only pre-funding campaigns can be cancelled: a `draft` campaign has no deals
 * yet, and a `confirmed` campaign has pending offers that are not yet funded.
 * Once funded, the campaign is on the money path and cancellation would strand
 * escrowed funds — that requires a different flow (not in scope here).
 *
 * The status guard runs inside the transaction, against a row held under
 * `SELECT ... FOR UPDATE`, so a concurrent fund cannot race past the check: the
 * fund path locks the same row, so one of the two waits for the other to commit
 * and then reads the status it actually left behind.
 */
export type CancelCampaignResult =
  | { ok: true; status: 'cancelled' }
  | { ok: false; reason: 'not_found' | 'not_cancellable' };

export interface CancelCampaignDeps {
  db: typeof defaultDb;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

const defaultDeps: CancelCampaignDeps = { db: defaultDb };

/** Cancellable statuses: before funding, the brand can walk away. */
const CANCELLABLE = new Set(['draft', 'confirmed']);

export async function cancelCampaign(
  campaignId: string,
  brandProfileId: string,
  deps: CancelCampaignDeps = defaultDeps
): Promise<CancelCampaignResult> {
  const guardFn = deps.guard ?? defaultGuard;
  await guardFn({ roles: ['brand'] });

  return deps.db.transaction(async (tx) => {
    // Lock the campaign row to prevent a concurrent fund from racing.
    //
    // `.for('update')` was missing until KAN-200 — the docstring above and the
    // comment here both claimed the lock and the query took none, so the status
    // check below was a read a concurrent `POST /fund` could commit straight past.
    // Fixed on the ticket that gave this path its first caller.
    const [row] = await tx
      .select({
        id: campaign.id,
        status: campaign.status,
        brandId: campaign.brandId,
      })
      .from(campaign)
      .where(eq(campaign.id, campaignId))
      .for('update')
      .limit(1);

    if (!row) return { ok: false, reason: 'not_found' };
    if (row.brandId !== brandProfileId)
      return { ok: false, reason: 'not_found' };
    if (!CANCELLABLE.has(row.status))
      return { ok: false, reason: 'not_cancellable' };

    await tx
      .update(campaign)
      .set({ status: 'cancelled' })
      .where(eq(campaign.id, campaignId));

    return { ok: true, status: 'cancelled' };
  });
}
