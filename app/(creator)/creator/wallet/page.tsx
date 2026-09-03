import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
import type { ChipTone } from '@/components/ui/chip';
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
import { cn } from '@/lib/utils';

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
 *
 * v4 conversion: shared creator shell, rail-card balance cells, and ruled
 * payout/withdrawal sections without changing wallet reads or forms.
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

const STATUS_ACCENT: Record<string, string> = {
  pending: 'bd-cw-row--wait',
  processing: 'bd-cw-row--live',
  paid: 'bd-cw-row--done',
  failed: 'bd-cw-row--wait',
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bd-railcell bd-cw-figure">
      <dt className="bd-railk">{label}</dt>
      <dd className="bd-railv bd-mono">{value}</dd>
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
      <BdShell className="bd-cw">
        <BdPageHead
          eyebrow="Creator workspace"
          title={WALLET_TITLE}
          facts="Earnings, payout method, and withdrawals."
          ruled
        />
        <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7.5h16v11H4z" />
              <path d="M8 7.5V5h8v2.5M16 13h4" />
            </svg>
            <h3>{WALLET_UNAVAILABLE_TITLE}</h3>
            <p>{WALLET_UNAVAILABLE_BODY}</p>
          </div>
        </div>
      </BdShell>
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
    <BdShell className="bd-cw">
      <BdPageHead
        eyebrow="Creator workspace"
        title={WALLET_TITLE}
        facts="Earnings land here when a brand approves your video. Withdraw them to your bank or telebirr account."
        ruled
      />

      <div
        className="bd-cw-split bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <aside className="bd-caprail bd-cw-rail">
          <dl className="bd-cw-figures">
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
          <div className="bd-railcell bd-cw-withdraw">
            <span className="bd-railk">Withdrawal</span>
            <span className="bd-railn">
              Send available earnings to your saved destination.
            </span>
            <WithdrawForm
              availableSantim={balance.available}
              formattedAvailable={formatEtb(balance.available)}
              methodSummary={
                method
                  ? `${method.bankName} ${method.accountNumberMasked}`
                  : null
              }
              testMode={uxMode === 'chapa-test'}
            />
          </div>
        </aside>

        <div className="bd-cw-main">
          <section className="bd-cw-section">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">{PAYOUT_METHOD_TITLE}</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              {method === null ? (
                <span className="bd-caprulernote">{PAYOUT_METHOD_EMPTY}</span>
              ) : null}
            </div>
            <div className="bd-cw-panel">
              <PayoutMethodForm
                banks={banks.map((bank) => ({
                  code: bank.code,
                  name: bank.name,
                }))}
                method={method}
              />
            </div>
          </section>

          <section className="bd-cw-section">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">{WITHDRAWALS_TITLE}</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulercount bd-mono">
                {withdrawals.length} {withdrawals.length === 1 ? 'row' : 'rows'}
              </span>
            </div>
            {withdrawals.length === 0 ? (
              <div className="bd-emptyfeed bd-cw-empty">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4.5 7.5h15v11h-15z" />
                  <path d="M8 7.5V5.5h8v2" />
                  <path d="M15.5 13h4" />
                </svg>
                <h3>No withdrawals yet</h3>
                <p>{WITHDRAWALS_EMPTY}</p>
              </div>
            ) : (
              <ul className="bd-cw-list">
                {withdrawals.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/creator/wallet/withdrawals/${row.id}`}
                      className={cn('bd-cw-row', STATUS_ACCENT[row.status])}
                    >
                      <div className="bd-cw-rowmain">
                        <span className="bd-cw-amount bd-mono">
                          {formatEtb(row.amount)}
                        </span>
                        <span className="bd-cw-meta">
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
      </div>
    </BdShell>
  );
}
