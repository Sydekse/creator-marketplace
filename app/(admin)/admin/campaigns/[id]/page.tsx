import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { getCampaignLedgerForAdmin } from '@/lib/admin/overview';
import { formatDeadlineUtc } from '@/lib/dates';
import { formatEtb } from '@/lib/money';

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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/campaigns"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Campaigns
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{campaign.name}</h1>
          <span
            className={
              reconciled
                ? 'rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white'
                : 'rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-white'
            }
          >
            {reconciled ? 'Reconciled' : 'Ledger out of balance'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {campaign.status} · budget {formatEtb(campaign.budget)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
            Held in escrow
          </h2>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatEtb(totals.held)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
            Paid out
          </h2>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatEtb(totals.paidOut)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
            Commission
          </h2>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatEtb(totals.commission)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
            Refunded
          </h2>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatEtb(totals.refunded)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
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
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No ledger entries yet — money has not moved on this campaign.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-border last:border-b-0 hover:bg-muted/30"
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
                    {entry.providerRef ?? '—'}
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
