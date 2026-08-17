import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/feedback/empty-state';
import { listCampaignsForAdmin } from '@/lib/admin/overview';
import { formatEtb } from '@/lib/money';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin campaign overview (KAN-78 over the KAN-53 read layer, US-010).
 *
 * One row per campaign with its ledger position: where the budget is, how
 * much is held in escrow, and the three ways money left it (payouts,
 * commission, refunds). All figures are the ledger's own sums
 * (`lib/admin/overview.ts`), never recomputed from statuses — so what the
 * screen shows cannot disagree with what invariant 7 guards.
 *
 * Rows link to the per-campaign ledger, which is where the reconciliation
 * check lives.
 */
export default async function AdminCampaignsPage() {
  const campaigns = await listCampaignsForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Every campaign and its ledger position — budget, escrow held, and what
          has left it.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Campaigns appear here the moment a brand creates one."
          action={
            <Link
              href="/admin"
              className={buttonVariants({ variant: 'outline' })}
            >
              Back to the console
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Budget</th>
                <th className="px-4 py-3 text-right font-medium">Held</th>
                <th className="px-4 py-3 text-right font-medium">Paid out</th>
                <th className="px-4 py-3 text-right font-medium">Commission</th>
                <th className="px-4 py-3 text-right font-medium">Refunded</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className="border-b border-border last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/campaigns/${campaign.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{campaign.status}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEtb(campaign.budget)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEtb(campaign.held)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEtb(campaign.paidOut)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEtb(campaign.commission)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEtb(campaign.refunded)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
