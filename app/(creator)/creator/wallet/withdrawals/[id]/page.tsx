import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
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
    <div className="flex items-baseline justify-between gap-6 py-2">
      <dt className="text-xs font-semibold tracking-wide text-neutral-600 uppercase">
        {label}
      </dt>
      <dd className="text-right text-sm text-brand-ink tabular-nums">
        {value}
      </dd>
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 print:max-w-none">
      <PageHeader
        label="Wallet"
        title="Withdrawal receipt"
        action={
          <Chip tone={STATUS_TONE[row.status] ?? 'gray'}>
            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
          </Chip>
        }
      />

      <p className="font-sans text-4xl font-bold tracking-[-0.04em] text-brand-ink tabular-nums">
        {formatEtb(row.amount)}
      </p>

      <p className="text-sm text-muted-foreground">
        {STATUS_COPY[row.status] ?? ''}
        {row.status === 'failed' && row.failureReason
          ? ` (${row.failureReason})`
          : ''}
      </p>

      <dl className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
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

      <p className="text-xs text-muted-foreground print:hidden">
        Use your browser&apos;s print function to save this receipt as a PDF.
      </p>

      <Link
        href="/creator/wallet"
        className="text-sm font-semibold text-brand-ink underline-offset-4 hover:underline print:hidden"
      >
        ← Back to wallet
      </Link>
    </div>
  );
}
