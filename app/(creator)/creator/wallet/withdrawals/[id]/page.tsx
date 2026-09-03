import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
import type { ChipTone } from '@/components/ui/chip';
import { guard } from '@/lib/authz';
import { requireRole } from '@/lib/auth';
import { formatEtb } from '@/lib/money';
import { UUID_REGEX } from '@/lib/validation';
import { getWithdrawalForCreator } from '@/lib/wallet/balance';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One withdrawal's receipt (KAN-70 PR 3).
 *
 * The read is scoped by owner inside `getWithdrawalForCreator`, so a pasted
 * id that is not this creator's answers the same 404 as one that never
 * existed — no existence oracle (NFR-005). The method details shown are the
 * snapshot the withdrawal itself carries: the receipt stays true even after
 * the payout method changes.
 *
 * v4 conversion: the receipt is a ruled creator wallet surface with a compact
 * fact ledger and print-safe back affordance.
 */

const STATUS_TONE: Record<string, ChipTone> = {
  pending: 'amber',
  processing: 'amber',
  paid: 'success',
  failed: 'red',
};

const STATUS_COPY: Record<string, string> = {
  pending:
    'Reserved from your balance — the transfer is being handed to Chapa.',
  processing: 'Chapa accepted the transfer and is sending it.',
  paid: 'The money arrived at your account.',
  failed:
    'The transfer did not go through. The full amount is back in your wallet.',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bd-fundrow bd-fundrow--mono">
      <dt>{label}</dt>
      <dd className="bd-mono">{value}</dd>
    </div>
  );
}

export default async function WithdrawalReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  await requireRole('creator');
  const ctx = await guard({ roles: ['creator'] });
  if (!ctx.creatorProfileId) redirect('/creator/onboarding');

  const row = await getWithdrawalForCreator(id, ctx.creatorProfileId);
  if (!row) notFound();

  const dateFormat: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };

  return (
    <BdShell className="bd-cw bd-cw-receipt">
      <BdPageHead
        eyebrow="Creator workspace"
        title="Withdrawal receipt"
        facts="A snapshot of the payout destination and transfer references."
        actions={
          <Chip tone={STATUS_TONE[row.status] ?? 'gray'}>
            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
          </Chip>
        }
        ruled
      />

      <div
        className="bd-fundwrap bd-cw-fundwrap bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <section className="bd-fundcard bd-cw-fundcard">
          <header className="bd-fundhead">
            <svg
              className={
                row.status === 'paid'
                  ? 'bd-fundicon--ok'
                  : row.status === 'failed'
                    ? 'bd-fundicon--bad'
                    : 'bd-fundicon--wait'
              }
              width="44"
              height="44"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M5.5 7h13v10h-13z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M8 10.5h8M8 13.5h5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <h1 className="bd-mono">{formatEtb(row.amount)}</h1>
            <p>
              {STATUS_COPY[row.status] ?? ''}
              {row.status === 'failed' && row.failureReason
                ? ` (${row.failureReason})`
                : ''}
            </p>
          </header>

          <dl className="bd-fundrows">
            <Row
              label="Destination"
              value={`${row.bankName} ${row.accountNumberMasked}`}
            />
            <Row label="Account holder" value={row.accountName} />
            <Row
              label="Requested"
              value={row.createdAt.toLocaleDateString('en-GB', dateFormat)}
            />
            {row.resolvedAt ? (
              <Row
                label={row.status === 'paid' ? 'Paid' : 'Resolved'}
                value={row.resolvedAt.toLocaleDateString('en-GB', dateFormat)}
              />
            ) : null}
            <Row label="Reference" value={row.txRef} />
            {row.providerRef ? (
              <Row label="Chapa reference" value={row.providerRef} />
            ) : null}
          </dl>

          <div className="bd-fundacts print:hidden">
            <Link href="/creator/wallet" className="bd-btn bd-btn--ghost">
              Back to wallet
            </Link>
          </div>
        </section>
      </div>

      <p className="bd-fundprint bd-cw-printnote print:hidden">
        Use your browser&apos;s print function to save this receipt as a PDF.
      </p>
    </BdShell>
  );
}
