import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
import type { ChipTone } from '@/components/ui/chip';
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
import { cn } from '@/lib/utils';

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
 *
 * v4 conversion: shared admin shell, rail-card totals, and compact ledger rows
 * around the same Chapa reconciliation data.
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

const SESSION_ACCENTS: Record<AdminFundingSessionRow['status'], string> = {
  initialized: 'bd-ad-payrow--wait',
  verified: 'bd-ad-payrow--wait',
  consumed: 'bd-ad-payrow--done',
  failed: 'bd-ad-payrow--wait',
  expired: 'bd-ad-payrow--dead',
};

const WITHDRAWAL_ACCENTS: Record<AdminWithdrawalRow['status'], string> = {
  pending: 'bd-ad-payrow--wait',
  processing: 'bd-ad-payrow--live',
  paid: 'bd-ad-payrow--done',
  failed: 'bd-ad-payrow--wait',
};

const REFUND_ACCENTS: Record<AdminRefundRow['status'], string> = {
  pending: 'bd-ad-payrow--wait',
  processing: 'bd-ad-payrow--live',
  refunded: 'bd-ad-payrow--done',
  failed: 'bd-ad-payrow--wait',
};

function TotalFigure({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="bd-railcell">
      <dt className="bd-railk">{label}</dt>
      <dd className="bd-railv bd-mono">{formatEtb(amount)}</dd>
    </div>
  );
}

function SectionEmpty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bd-emptyfeed">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 7.5h15v10h-15z" />
        <path d="M8 7.5V5.5h8v2" />
        <path d="M8 12.5h4" />
        <path d="M15.5 12.5h4" />
      </svg>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default async function AdminPaymentsPage() {
  const view = await readPaymentsForAdmin();

  return (
    <BdShell className="bd-ad bd-ad-payments">
      <BdPageHead
        eyebrow="Admin console"
        title="Payments"
        facts={
          <>
            <span className="bd-mono">{view.sessions.length}</span> deposits ·{' '}
            <span className="bd-mono">{view.withdrawals.length}</span>{' '}
            withdrawals · <span className="bd-mono">{view.refunds.length}</span>{' '}
            refunds
          </>
        }
        ruled
      />

      <dl
        className="bd-caprail bd-ad-paymenttotals bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <TotalFigure label="Deposited" amount={view.totals.deposited} />
        <TotalFigure label="Escrow held" amount={view.totals.escrowHeld} />
        <TotalFigure label="Withdrawn" amount={view.totals.withdrawn} />
        <TotalFigure label="Refunded" amount={view.totals.refunded} />
        <TotalFigure label="Commission" amount={view.totals.commission} />
      </dl>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Deposits</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {view.sessions.length}{' '}
            {view.sessions.length === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        {view.sessions.length === 0 ? (
          <SectionEmpty title="No deposits yet">
            No Chapa checkouts yet — mock-funded campaigns do not appear here.
          </SectionEmpty>
        ) : (
          <ul className="bd-ad-list">
            {view.sessions.map((row) => (
              <li
                key={row.id}
                className={cn('bd-ad-payrow', SESSION_ACCENTS[row.status])}
              >
                <div className="bd-ad-paymain">
                  <p>
                    {row.campaignName}
                    <span> · {row.brandCompanyName}</span>
                  </p>
                  <p className="bd-mono">
                    {row.txRef}
                    {row.failureReason ? ` · ${row.failureReason}` : ''}
                  </p>
                </div>
                <div className="bd-ad-paymeta">
                  <span>{ageLabel(row.createdAt)}</span>
                  <span className="bd-mono">{formatEtb(row.amount)}</span>
                  <Chip tone={SESSION_TONES[row.status]}>{row.status}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 3 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Withdrawals</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {view.withdrawals.length}{' '}
            {view.withdrawals.length === 1 ? 'withdrawal' : 'withdrawals'}
          </span>
        </div>
        {view.withdrawals.length === 0 ? (
          <SectionEmpty title="No withdrawals yet">
            Creator payout requests will appear here after they leave the
            wallet.
          </SectionEmpty>
        ) : (
          <ul className="bd-ad-list">
            {view.withdrawals.map((row) => (
              <li
                key={row.id}
                className={cn('bd-ad-payrow', WITHDRAWAL_ACCENTS[row.status])}
              >
                <div className="bd-ad-paymain">
                  <p>
                    {displayTiktokHandle(row.creatorHandle)}
                    <span> · {row.bankName}</span>
                  </p>
                  <p className="bd-mono">
                    {row.txRef}
                    {row.failureReason ? ` · ${row.failureReason}` : ''}
                  </p>
                </div>
                <div className="bd-ad-paymeta">
                  <span>{ageLabel(row.createdAt)}</span>
                  <span className="bd-mono">{formatEtb(row.amount)}</span>
                  <Chip tone={WITHDRAWAL_TONES[row.status]}>{row.status}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 4 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Refunds</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {view.refunds.length}{' '}
            {view.refunds.length === 1 ? 'refund' : 'refunds'}
          </span>
        </div>
        {view.refunds.length === 0 ? (
          <SectionEmpty title="No external refunds yet">
            No external refunds yet — rows appear when a dispute resolves as a
            refund in Chapa mode.
          </SectionEmpty>
        ) : (
          <ul className="bd-ad-list">
            {view.refunds.map((row) => (
              <li
                key={row.id}
                className={cn('bd-ad-payrow', REFUND_ACCENTS[row.status])}
              >
                <div className="bd-ad-paymain">
                  <p>
                    {row.campaignName}
                    <span> · {row.brandCompanyName}</span>
                  </p>
                  <p className="bd-mono">
                    {row.fundingTxRef}
                    {row.failureReason ? ` · ${row.failureReason}` : ''}
                  </p>
                </div>
                <div className="bd-ad-paymeta">
                  <span>{ageLabel(row.createdAt)}</span>
                  <span className="bd-mono">{formatEtb(row.amount)}</span>
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
    </BdShell>
  );
}
