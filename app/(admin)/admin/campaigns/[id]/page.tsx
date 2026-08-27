import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
import { getCampaignLedgerForAdmin } from '@/lib/admin/overview';
import { formatDeadlineUtc } from '@/lib/dates';
import { formatEtb } from '@/lib/money';
import { cn, textLinkFeedback } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One campaign's full ledger (KAN-78 over the KAN-53 read layer).
 *
 * `getCampaignLedgerForAdmin` returns the entries oldest-first in write order
 * (`seq`, the bigserial — `created_at` is transaction start, so entries
 * written together share it), the totals folded from those same entries, and
 * the reconciliation verdict: `sum(amount)` equals the last entry's
 * `balance_after`, or the chain is corrupt. A green badge is the operator's
 * answer to "does this ledger add up"; a red one is an actual anomaly, not a
 * styling choice.
 *
 * The signed amounts render with the ledger's own U+2212 minus sign
 * (`formatEtb`), so a release reads as −ETB rather than a hyphen-ambiguous
 * dash.
 */
export default async function AdminCampaignLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ledger = await getCampaignLedgerForAdmin(id);
  if (!ledger) notFound();

  const { campaign, entries, totals, reconciled } = ledger;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/campaigns"
          className={cn('text-sm text-muted-foreground', textLinkFeedback)}
        >
          ← Campaigns
        </Link>
        <PageHeader
          label="Campaign ledger"
          title={campaign.name}
          action={
            <Chip tone={reconciled ? 'success' : 'red'} size="md">
              {reconciled ? 'Reconciled' : 'Ledger out of balance'}
            </Chip>
          }
          description={`${campaign.status} · Budget ${formatEtb(campaign.budget)}`}
        />
      </div>

      <dl className="grid rounded-[24px] bg-neutral-900 text-neutral-50 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-b border-neutral-200 p-5 sm:border-r lg:border-b-0">
          <dt className="text-xs tracking-wide text-neutral-400 uppercase">
            Held in escrow
          </dt>
          <dd className="mt-2 font-mono text-base text-neutral-50">
            {formatEtb(totals.held)}
          </dd>
        </div>
        <div className="border-b border-neutral-200 p-5 lg:border-r lg:border-b-0">
          <dt className="text-xs tracking-wide text-neutral-400 uppercase">
            Paid out
          </dt>
          <dd className="mt-2 font-mono text-base text-neutral-50">
            {formatEtb(totals.paidOut)}
          </dd>
        </div>
        <div className="border-b border-neutral-200 p-5 sm:border-r sm:border-b-0">
          <dt className="text-xs tracking-wide text-neutral-400 uppercase">
            Commission
          </dt>
          <dd className="mt-2 font-mono text-base text-neutral-50">
            {formatEtb(totals.commission)}
          </dd>
        </div>
        <div className="p-5">
          <dt className="text-xs tracking-wide text-neutral-400 uppercase">
            Refunded
          </dt>
          <dd className="mt-2 font-mono text-base text-neutral-50">
            {formatEtb(totals.refunded)}
          </dd>
        </div>
      </dl>

      <div className="overflow-x-auto border-y border-neutral-200 bg-neutral-50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-100/70 text-left text-[11px] tracking-[0.12em] text-neutral-500 uppercase">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">
                Balance after
              </th>
              <th className="px-4 py-3 font-medium">Provider ref</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-left text-muted-foreground"
                >
                  No ledger entries yet. Money has not moved on this campaign.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-neutral-200 last:border-b-0 hover:bg-neutral-100/60"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {entry.seq}
                  </td>
                  <td className="px-4 py-2.5">{entry.entryType}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatEtb(entry.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatEtb(entry.balanceAfter)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {entry.providerRef ?? 'Not provided'}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatDeadlineUtc(entry.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div>
        <Link
          href="/admin"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Back to the console
        </Link>
      </div>
    </div>
  );
}
