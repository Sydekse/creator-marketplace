import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { deal, ledgerEntry, withdrawal } from '@/db/schema';

/**
 * The creator's wallet, read from two ledgers (KAN-70 PR 3).
 *
 * `withdrawal` *is* the wallet's spend side — see the table's own comment in
 * `db/schema.ts` for why it is not more `ledger_entry` types. The earn side is
 * the escrow ledger's `release_payout` entries, the same figure the dashboard
 * already reports as "paid out to date".
 *
 * A withdrawal counts against the balance from the moment its row exists
 * (`pending` and `processing` alike): the money is spoken for before Chapa
 * confirms anything, which is what makes a concurrent second withdrawal unable
 * to double-spend. Only `failed` rows give the money back.
 */
export interface WalletBalance {
  /** Σ release_payout for the creator's deals — lifetime earnings, santim. */
  earned: number;
  /** Σ withdrawals actually paid out. */
  withdrawn: number;
  /** Σ withdrawals still pending/processing — spoken for, not yet landed. */
  inFlight: number;
  /** earned − withdrawn − inFlight. Never negative in a consistent database. */
  available: number;
}

/**
 * The database handle seam: the withdrawal action re-runs this inside its
 * serializable transaction so the balance it checks is the balance it spends.
 */
type Dbish = Pick<typeof db, 'select'>;

export async function readWalletBalance(
  creatorProfileId: string,
  dbc: Dbish = db
): Promise<WalletBalance> {
  const [earnRow] = await dbc
    .select({
      // release_payout entries are negative (money leaving escrow); negate to
      // report earnings. `::int` because SUM returns bigint-as-string — the
      // same trap `earningsQuery` documents.
      earned: sql<number>`COALESCE(SUM(-${ledgerEntry.amount}), 0)::int`,
    })
    .from(ledgerEntry)
    .innerJoin(deal, eq(ledgerEntry.dealId, deal.id))
    .where(
      and(
        eq(deal.creatorId, creatorProfileId),
        eq(ledgerEntry.entryType, 'release_payout')
      )
    );

  const [spendRow] = await dbc
    .select({
      withdrawn: sql<number>`COALESCE(SUM(${withdrawal.amount}) FILTER (WHERE ${withdrawal.status} = 'paid'), 0)::int`,
      inFlight: sql<number>`COALESCE(SUM(${withdrawal.amount}) FILTER (WHERE ${withdrawal.status} IN ('pending', 'processing')), 0)::int`,
    })
    .from(withdrawal)
    .where(
      and(
        eq(withdrawal.creatorId, creatorProfileId),
        ne(withdrawal.status, 'failed')
      )
    );

  const earned = earnRow?.earned ?? 0;
  const withdrawn = spendRow?.withdrawn ?? 0;
  const inFlight = spendRow?.inFlight ?? 0;
  return {
    earned,
    withdrawn,
    inFlight,
    available: earned - withdrawn - inFlight,
  };
}

/** The creator's withdrawal rows, newest first, for the history table. */
export async function listWithdrawals(creatorProfileId: string) {
  return db
    .select({
      id: withdrawal.id,
      amount: withdrawal.amount,
      status: withdrawal.status,
      txRef: withdrawal.txRef,
      providerRef: withdrawal.providerRef,
      methodKind: withdrawal.methodKind,
      bankName: withdrawal.bankName,
      accountNumberMasked: withdrawal.accountNumberMasked,
      accountName: withdrawal.accountName,
      failureReason: withdrawal.failureReason,
      createdAt: withdrawal.createdAt,
      resolvedAt: withdrawal.resolvedAt,
    })
    .from(withdrawal)
    .where(eq(withdrawal.creatorId, creatorProfileId))
    .orderBy(sql`${withdrawal.createdAt} DESC`);
}

/**
 * One withdrawal, scoped to its owner — the receipt page's read. A pasted id
 * that belongs to someone else answers nothing rather than leaking that the
 * row exists.
 */
export async function getWithdrawalForCreator(
  id: string,
  creatorProfileId: string
) {
  const [row] = await db
    .select({
      id: withdrawal.id,
      amount: withdrawal.amount,
      status: withdrawal.status,
      txRef: withdrawal.txRef,
      providerRef: withdrawal.providerRef,
      methodKind: withdrawal.methodKind,
      bankName: withdrawal.bankName,
      accountNumberMasked: withdrawal.accountNumberMasked,
      accountName: withdrawal.accountName,
      failureReason: withdrawal.failureReason,
      createdAt: withdrawal.createdAt,
      resolvedAt: withdrawal.resolvedAt,
    })
    .from(withdrawal)
    .where(
      and(eq(withdrawal.id, id), eq(withdrawal.creatorId, creatorProfileId))
    )
    .limit(1);
  return row ?? null;
}
