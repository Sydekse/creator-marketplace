import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { payoutMethod } from '@/db/schema';
import type { PayoutMethodKind } from '@/db/schema';
import { getPaymentGateway } from '@/lib/payment/gateway';
import type { ChapaBank } from '@/lib/chapa/client';
import { ChapaError } from '@/lib/chapa/client';

/**
 * Where a creator's withdrawals go (KAN-70 PR 3).
 *
 * One method per creator, updated in place — the schema's unique constraint on
 * `creator_id` is the storage-level statement of the same MVP decision. A
 * withdrawal snapshots the method it used, so editing this never rewrites
 * history.
 *
 * The bank code is validated against Chapa's own `GET /banks` at save time
 * rather than trusted from the form: the list is also what populated the form,
 * but a request is not a form, and a made-up code would otherwise surface as a
 * confusing transfer failure days later.
 */

export interface SavePayoutMethodInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export type SavePayoutMethodResult =
  | { ok: true; method: PayoutMethodView }
  | { ok: false; reason: 'gateway_unavailable' }
  | { ok: false; reason: 'invalid'; fieldErrors: Record<string, string[]> };

export interface PayoutMethodView {
  kind: PayoutMethodKind;
  bankCode: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
}

/** Last four digits, the rest dots — the only shape that leaves this module. */
export function maskAccountNumber(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `••••${last4}`;
}

export interface PayoutMethodDeps {
  listBanks: () => Promise<ChapaBank[] | null>;
  upsert: (
    creatorProfileId: string,
    row: {
      kind: PayoutMethodKind;
      bankCode: string;
      bankName: string;
      accountNumber: string;
      accountName: string;
    }
  ) => Promise<void>;
}

const defaultDeps: PayoutMethodDeps = {
  listBanks: async () => {
    const gateway = getPaymentGateway();
    if (!gateway) return null;
    return gateway.listBanks();
  },
  upsert: async (creatorProfileId, row) => {
    await db
      .insert(payoutMethod)
      .values({ creatorId: creatorProfileId, ...row })
      .onConflictDoUpdate({
        target: payoutMethod.creatorId,
        set: { ...row, updatedAt: new Date() },
      });
  },
};

const NAME_MIN = 2;
const NAME_MAX = 100;

export async function savePayoutMethod(
  creatorProfileId: string,
  input: SavePayoutMethodInput,
  deps: PayoutMethodDeps = defaultDeps
): Promise<SavePayoutMethodResult> {
  let banks: ChapaBank[] | null;
  try {
    banks = await deps.listBanks();
  } catch (error) {
    if (error instanceof ChapaError) {
      return { ok: false, reason: 'gateway_unavailable' };
    }
    throw error;
  }
  if (banks === null) return { ok: false, reason: 'gateway_unavailable' };

  const fieldErrors: Record<string, string[]> = {};
  const bank = banks.find((b) => b.code === input.bankCode);
  if (!bank) {
    fieldErrors.bankCode = ['Choose a bank from the list.'];
  }

  const accountNumber = input.accountNumber.trim();
  if (!/^\d{6,20}$/.test(accountNumber)) {
    fieldErrors.accountNumber = ['Enter the account number, digits only.'];
  } else if (
    bank?.accountLength != null &&
    accountNumber.length !== bank.accountLength
  ) {
    fieldErrors.accountNumber = [
      `${bank.name} account numbers are ${bank.accountLength} digits.`,
    ];
  }

  const accountName = input.accountName.trim();
  if (accountName.length < NAME_MIN || accountName.length > NAME_MAX) {
    fieldErrors.accountName = ['Enter the account holder name.'];
  }

  if (Object.keys(fieldErrors).length > 0 || !bank) {
    return { ok: false, reason: 'invalid', fieldErrors };
  }

  const kind: PayoutMethodKind = bank.isMobileMoney ? 'telebirr' : 'bank';
  await deps.upsert(creatorProfileId, {
    kind,
    bankCode: bank.code,
    bankName: bank.name,
    accountNumber,
    accountName,
  });

  return {
    ok: true,
    method: {
      kind,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumberMasked: maskAccountNumber(accountNumber),
      accountName,
    },
  };
}

/**
 * The creator's saved method, masked — what the wallet page and the withdraw
 * dialog show. The full account number never leaves the module except into a
 * transfer request.
 */
export async function getPayoutMethodView(
  creatorProfileId: string
): Promise<PayoutMethodView | null> {
  const [row] = await db
    .select()
    .from(payoutMethod)
    .where(eq(payoutMethod.creatorId, creatorProfileId))
    .limit(1);
  if (!row) return null;
  return {
    kind: row.kind,
    bankCode: row.bankCode,
    bankName: row.bankName,
    accountNumberMasked: maskAccountNumber(row.accountNumber),
    accountName: row.accountName,
  };
}
