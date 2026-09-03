import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { SectionLabel } from '@/components/layout/section-label';
import { Chip } from '@/components/ui/chip';
import type { ChipTone } from '@/components/ui/chip';
import { EmptyState } from '@/components/feedback/empty-state';
import { PayoutMethodForm } from '@/components/wallet/payout-method-form';
import { WithdrawForm } from '@/components/wallet/withdraw-form';
import { guard } from '@/lib/authz';
import { requireRole } from '@/lib/auth';
import { formatEtb } from '@/lib/money';
import { getPaymentGateway, paymentUxMode } from '@/lib/payment/gateway';
import { listWithdrawals, readWalletBalance } from '@/lib/wallet/balance';
import { getPayoutMethodView } from '@/lib/wallet/payout-method';
import {
  PAYOUT_METHOD_EMPTY,
  PAYOUT_METHOD_TITLE,
  WALLET_AVAILABLE_LABEL,
  WALLET_LIFETIME_LABEL,
  WALLET_PENDING_LABEL,
  WALLET_TITLE,
  WALLET_UNAVAILABLE_BODY,
  WALLET_UNAVAILABLE_TITLE,
  WITHDRAWALS_EMPTY,
  WITHDRAWALS_TITLE,
} from '@/lib/wallet/constants';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The creator's wallet (KAN-70 PR 3): balance, payout method, withdrawals.
 *
 * Same two-layer gate as the dashboard: `requireRole` redirects strangers,
 * `guard` inside resolves the creator's own profile id — the page takes no id
 * and can render nobody else's money (NFR-005).
 *
 * In mock mode (no `CHAPA_SECRET_KEY`) the page states plainly that there is
 * no payout rail here rather than hiding: a creator who follows a link should
 * learn why, not get a 404.
 */

const STATUS_TONE: Record<string, ChipTone> = {
  pending: 'amber',
  processing: 'amber',
  paid: 'success',
  failed: 'red',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-neutral-200 bg-background px-4 py-4">
      <dt className="text-xs font-semibold tracking-wide text-neutral-600 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-sans text-3xl font-bold tracking-[-0.04em] text-brand-ink tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export default async function WalletPage() {
  await requireRole('creator');
  const ctx = await guard({ roles: ['creator'] });
  if (!ctx.creatorProfileId) redirect('/creator/onboarding');
  const creatorProfileId = ctx.creatorProfileId;

  const uxMode = paymentUxMode();
  if (uxMode === 'mock') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <PageHeader label="Creator" title={WALLET_TITLE} />
        <EmptyState
          title={WALLET_UNAVAILABLE_TITLE}
          description={WALLET_UNAVAILABLE_BODY}
        />
      </div>
    );
  }

  const gateway = getPaymentGateway();
  const [balance, method, withdrawals, banks] = await Promise.all([
    readWalletBalance(creatorProfileId),
    getPayoutMethodView(creatorProfileId),
    listWithdrawals(creatorProfileId),
    // The bank list is form furniture: if Chapa's list endpoint is down the
    // wallet still renders, with the form waiting on a reload.
    gateway ? gateway.listBanks().catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <PageHeader
        label="Creator"
        title={WALLET_TITLE}
        description="Earnings land here when a brand approves your video. Withdraw them to your bank or telebirr account."
      />

      <section className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Figure
            label={WALLET_AVAILABLE_LABEL}
            value={formatEtb(balance.available)}
          />
          <Figure
            label={WALLET_LIFETIME_LABEL}
            value={formatEtb(balance.earned)}
          />
          <Figure
            label={WALLET_PENDING_LABEL}
            value={formatEtb(balance.inFlight)}
          />
        </dl>
        <WithdrawForm
          availableSantim={balance.available}
          formattedAvailable={formatEtb(balance.available)}
          methodSummary={
            method ? `${method.bankName} ${method.accountNumberMasked}` : null
          }
          testMode={uxMode === 'chapa-test'}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200 pt-8">
        <SectionLabel>{PAYOUT_METHOD_TITLE}</SectionLabel>
        {method === null ? (
          <p className="text-sm text-muted-foreground">{PAYOUT_METHOD_EMPTY}</p>
        ) : null}
        <PayoutMethodForm
          banks={banks.map((bank) => ({ code: bank.code, name: bank.name }))}
          method={method}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200 pt-8">
        <SectionLabel>{WITHDRAWALS_TITLE}</SectionLabel>
        {withdrawals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{WITHDRAWALS_EMPTY}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200">
            {withdrawals.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/creator/wallet/withdrawals/${row.id}`}
                  className="flex items-center justify-between gap-4 py-3 hover:bg-neutral-50"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-brand-ink tabular-nums">
                      {formatEtb(row.amount)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.bankName} {row.accountNumberMasked} ·{' '}
                      {row.createdAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <Chip tone={STATUS_TONE[row.status] ?? 'gray'}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </Chip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
