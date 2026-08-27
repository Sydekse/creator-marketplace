import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { listCampaignsForAdmin } from '@/lib/admin/overview';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import { formatEtb } from '@/lib/money';
import { cn, textLinkFeedback } from '@/lib/utils';

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
    <div className="flex flex-col gap-10">
      <PageHeader
        label="Ledger oversight"
        title="Campaigns"
        description="Every campaign and its ledger position, including budget, escrow, payouts, commission, and refunds."
      />

      {campaigns.length === 0 ? (
        <EmptyState
          align="start"
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
        <div className="overflow-x-auto border-y border-neutral-200 bg-neutral-50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-100/70 text-left text-[11px] tracking-[0.12em] text-neutral-500 uppercase">
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
                  className="border-b border-neutral-200 last:border-b-0 hover:bg-neutral-100/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/campaigns/${campaign.id}`}
                      className={cn('font-medium', textLinkFeedback)}
                    >
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Chip
                      tone={campaignStatusTone[campaign.status] ?? 'gray'}
                      className="capitalize"
                    >
                      {campaignStatusLabel(campaign.status)}
                    </Chip>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {formatEtb(campaign.budget)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {formatEtb(campaign.held)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {formatEtb(campaign.paidOut)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {formatEtb(campaign.commission)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
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
