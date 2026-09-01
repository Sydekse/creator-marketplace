import { Chip } from '@/components/ui/chip';
import type { ChipTone } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
import { RetryRefundButton } from '@/components/admin/retry-refund-button';
import { readPaymentsForAdmin } from '@/lib/admin/payments';
import type {
  AdminFundingSessionRow,
  AdminRefundRow,
  AdminWithdrawalRow,
} from '@/lib/admin/payments';
import { ageLabel } from '@/lib/dates';
import { formatEtb } from '@/lib/money';
import { displayTiktokHandle } from '@/lib/creators/handle';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin payments & reconciliation view (KAN-70 PR 4).
 *
 * One page answering "where is the external money": recent Chapa deposits,
 * withdrawals, and refunds with their statuses, plus the totals an operator
 * needs to sanity-check our ledger against the Chapa dashboard balance. A
 * `failed` refund row carries the retry button — the internal books are
 * already correct, so the retry only re-asks the gateway.
 *
 * The read embeds its own admin gate on top of the `(admin)` layout's role
 * gate, the same double-gate `worklist/page.tsx` documents.
 */

const SESSION_TONES: Record<AdminFundingSessionRow['status'], ChipTone> = {
  initialized: 'amber',
  verified: 'amber',
  consumed: 'success',
  failed: 'red',
  expired: 'gray',
};

const WITHDRAWAL_TONES: Record<AdminWithdrawalRow['status'], ChipTone> = {
  pending: 'amber',
  processing: 'amber',
  paid: 'success',
  failed: 'red',
};

const REFUND_TONES: Record<AdminRefundRow['status'], ChipTone> = {
  pending: 'amber',
  processing: 'amber',
  refunded: 'success',
  failed: 'red',
};

function TotalFigure({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-neutral-200 pl-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-semibold text-neutral-900 tabular-nums">
        {formatEtb(amount)}
      </dd>
    </div>
  );
}

function SectionEmpty({ children }: { children: string }) {
  return <p className="px-1 py-4 text-sm text-muted-foreground">{children}</p>;
}

export default async function AdminPaymentsPage() {
  const view = await readPaymentsForAdmin();

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        label="Money operations"
        title="Payments"
        description="Every Chapa deposit, withdrawal, and refund with its status — the figures to reconcile our ledger against the gateway balance."
      />

      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        <TotalFigure label="Deposited" amount={view.totals.deposited} />
        <TotalFigure label="Escrow held" amount={view.totals.escrowHeld} />
        <TotalFigure label="Withdrawn" amount={view.totals.withdrawn} />
        <TotalFigure label="Refunded" amount={view.totals.refunded} />
        <TotalFigure label="Commission" amount={view.totals.commission} />
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-neutral-900">Deposits</h2>
        {view.sessions.length === 0 ? (
          <SectionEmpty>
            No Chapa checkouts yet — mock-funded campaigns do not appear here.
          </SectionEmpty>
        ) : (
          <ul className="border-y border-neutral-200">
            {view.sessions.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-1 py-4 last:border-b-0 sm:px-4"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-neutral-900">
                    {row.campaignName}
                    <span className="text-muted-foreground">
                      {' '}
                      · {row.brandCompanyName}
                    </span>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.txRef}
                    {row.failureReason ? ` · ${row.failureReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {ageLabel(row.createdAt)}
                  </span>
                  <span className="font-semibold text-neutral-900 tabular-nums">
                    {formatEtb(row.amount)}
                  </span>
                  <Chip tone={SESSION_TONES[row.status]}>{row.status}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-neutral-900">Withdrawals</h2>
        {view.withdrawals.length === 0 ? (
          <SectionEmpty>No withdrawals yet.</SectionEmpty>
        ) : (
          <ul className="border-y border-neutral-200">
            {view.withdrawals.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-1 py-4 last:border-b-0 sm:px-4"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-neutral-900">
                    {displayTiktokHandle(row.creatorHandle)}
                    <span className="text-muted-foreground">
                      {' '}
                      · {row.bankName}
                    </span>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.txRef}
                    {row.failureReason ? ` · ${row.failureReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {ageLabel(row.createdAt)}
                  </span>
                  <span className="font-semibold text-neutral-900 tabular-nums">
                    {formatEtb(row.amount)}
                  </span>
                  <Chip tone={WITHDRAWAL_TONES[row.status]}>{row.status}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-neutral-900">Refunds</h2>
        {view.refunds.length === 0 ? (
          <SectionEmpty>
            No external refunds yet — rows appear when a dispute resolves as a
            refund in Chapa mode.
          </SectionEmpty>
        ) : (
          <ul className="border-y border-neutral-200">
            {view.refunds.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-1 py-4 last:border-b-0 sm:px-4"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-neutral-900">
                    {row.campaignName}
                    <span className="text-muted-foreground">
                      {' '}
                      · {row.brandCompanyName}
                    </span>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.fundingTxRef}
                    {row.failureReason ? ` · ${row.failureReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {ageLabel(row.createdAt)}
                  </span>
                  <span className="font-semibold text-neutral-900 tabular-nums">
                    {formatEtb(row.amount)}
                  </span>
                  <Chip tone={REFUND_TONES[row.status]}>{row.status}</Chip>
                  {row.status === 'failed' && (
                    <RetryRefundButton
                      refundId={row.id}
                      campaignName={row.campaignName}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
