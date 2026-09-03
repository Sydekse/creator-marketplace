import Link from 'next/link';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
import { listCampaignsForAdmin } from '@/lib/admin/overview';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import { formatEtb } from '@/lib/money';
import { cn, textLinkFeedback } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

const CAMPAIGN_ACCENT: Record<string, string> = {
  draft: 'bd-ad-ledgerrow--dead',
  confirmed: 'bd-ad-ledgerrow--wait',
  funded: 'bd-ad-ledgerrow--live',
  in_progress: 'bd-ad-ledgerrow--live',
  completed: 'bd-ad-ledgerrow--done',
  cancelled: 'bd-ad-ledgerrow--dead',
};

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
 *
 * v4 conversion: the admin campaign table sits under the shared console
 * masthead and v4 ledger table chrome; values still come from the read layer.
 */
export default async function AdminCampaignsPage() {
  const campaigns = await listCampaignsForAdmin();
  const totals = campaigns.reduce(
    (sum, campaign) => ({
      budget: sum.budget + campaign.budget,
      held: sum.held + campaign.held,
    }),
    { budget: 0, held: 0 }
  );

  return (
    <BdShell className="bd-ad bd-ad-campaigns">
      <BdPageHead
        eyebrow="Admin console"
        title="Campaigns"
        facts={
          <>
            <span className="bd-mono">{campaigns.length}</span> campaigns ·{' '}
            <span className="bd-mono">{formatEtb(totals.budget)}</span> budget ·{' '}
            <span className="bd-mono">{formatEtb(totals.held)}</span> held
          </>
        }
        ruled
      />

      {campaigns.length === 0 ? (
        <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 6.5h14v11H5z" />
              <path d="M8 10h8" />
              <path d="M8 13h5" />
              <path d="M6.5 4.5h11" />
            </svg>
            <h3>No campaigns yet</h3>
            <p>Campaigns appear here the moment a brand creates one.</p>
            <Link href="/admin" className="bd-btn bd-btn--ghost">
              Back to the console
            </Link>
          </div>
        </div>
      ) : (
        <section
          className="bd-ad-section bd-rise"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Campaign ledger</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulercount bd-mono">
              {campaigns.length}{' '}
              {campaigns.length === 1 ? 'campaign' : 'campaigns'}
            </span>
          </div>
          <div className="bd-ad-ledgerframe">
            <div className="bd-ad-ledgercols" aria-hidden="true">
              <span>Campaign</span>
              <span>Status</span>
              <span>Budget</span>
              <span>Held</span>
              <span>Paid out</span>
              <span>Commission</span>
              <span>Refunded</span>
            </div>
            <ul className="bd-ad-ledgerlist">
              {campaigns.map((campaign) => (
                <li
                  key={campaign.id}
                  className={cn(
                    'bd-ad-ledgerrow bd-ad-campaignrow',
                    CAMPAIGN_ACCENT[campaign.status] ?? 'bd-ad-ledgerrow--dead'
                  )}
                >
                  <div className="bd-ad-ledgermain">
                    <Link
                      href={`/admin/campaigns/${campaign.id}`}
                      className={cn('bd-ad-link', textLinkFeedback)}
                    >
                      {campaign.name}
                    </Link>
                  </div>
                  <div>
                    <Chip
                      tone={campaignStatusTone[campaign.status] ?? 'gray'}
                      className="capitalize"
                    >
                      {campaignStatusLabel(campaign.status)}
                    </Chip>
                  </div>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(campaign.budget)}
                  </span>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(campaign.held)}
                  </span>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(campaign.paidOut)}
                  </span>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(campaign.commission)}
                  </span>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(campaign.refunded)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </BdShell>
  );
}
