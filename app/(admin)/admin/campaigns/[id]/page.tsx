import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
import { getCampaignLedgerForAdmin } from '@/lib/admin/overview';
import { formatDeadlineUtc } from '@/lib/dates';
import { formatEtb } from '@/lib/money';
import { cn, textLinkFeedback } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

const ENTRY_ACCENT: Record<string, string> = {
  hold: 'bd-ad-ledgerrow--live',
  release_payout: 'bd-ad-ledgerrow--done',
  commission: 'bd-ad-ledgerrow--dead',
  refund: 'bd-ad-ledgerrow--wait',
};

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
 *
 * v4 conversion: the detail page uses the admin console masthead, rail-card
 * totals, and v4 ledger table while preserving reconciliation reads.
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
    <BdShell className="bd-ad bd-ad-campaignledger">
      <Link
        href="/admin/campaigns"
        className={cn('bd-cdback', textLinkFeedback)}
      >
        ← Campaigns
      </Link>
      <BdPageHead
        eyebrow="Admin console"
        title={campaign.name}
        actions={
          <Chip tone={reconciled ? 'success' : 'red'} size="md">
            {reconciled ? 'Reconciled' : 'Ledger out of balance'}
          </Chip>
        }
        facts={
          <>
            {campaign.status} · Budget{' '}
            <span className="bd-mono">{formatEtb(campaign.budget)}</span> ·{' '}
            <span className="bd-mono">{entries.length}</span> entries
          </>
        }
        ruled
        rise={1}
      />

      <dl
        className="bd-caprail bd-ad-totals bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <div className="bd-railcell">
          <dt className="bd-railk">Held in escrow</dt>
          <dd className="bd-railv bd-mono">{formatEtb(totals.held)}</dd>
        </div>
        <div className="bd-railcell">
          <dt className="bd-railk">Paid out</dt>
          <dd className="bd-railv bd-mono">{formatEtb(totals.paidOut)}</dd>
        </div>
        <div className="bd-railcell">
          <dt className="bd-railk">Commission</dt>
          <dd className="bd-railv bd-mono">{formatEtb(totals.commission)}</dd>
        </div>
        <div className="bd-railcell">
          <dt className="bd-railk">Refunded</dt>
          <dd className="bd-railv bd-mono">{formatEtb(totals.refunded)}</dd>
        </div>
      </dl>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 3 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Entries</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        {entries.length === 0 ? (
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4.5h12v15H6z" />
              <path d="M9 8h6" />
              <path d="M9 11.5h6" />
              <path d="M9 15h3" />
            </svg>
            <h3>No ledger entries yet</h3>
            <p>
              Money has not moved on this campaign, so there is nothing to
              reconcile.
            </p>
            <Link href="/admin/campaigns" className="bd-btn bd-btn--ghost">
              Back to campaigns
            </Link>
          </div>
        ) : (
          <div className="bd-ad-ledgerframe">
            <div
              className="bd-ad-ledgercols bd-ad-ledgercols--entries"
              aria-hidden="true"
            >
              <span>#</span>
              <span>Type</span>
              <span>Amount</span>
              <span>Balance after</span>
              <span>Provider ref</span>
              <span>When</span>
            </div>
            <ul className="bd-ad-ledgerlist">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    'bd-ad-ledgerrow bd-ad-entryrow',
                    ENTRY_ACCENT[entry.entryType] ?? 'bd-ad-ledgerrow--dead'
                  )}
                >
                  <span className="bd-ad-ledgeridx bd-mono">{entry.seq}</span>
                  <span className="bd-ad-ledgermain">{entry.entryType}</span>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(entry.amount)}
                  </span>
                  <span className="bd-ad-ledgernum bd-mono">
                    {formatEtb(entry.balanceAfter)}
                  </span>
                  <span className="bd-ad-ledgermeta bd-mono">
                    {entry.providerRef ?? 'Not provided'}
                  </span>
                  <span className="bd-ad-ledgermeta">
                    {formatDeadlineUtc(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div>
        <Link href="/admin" className="bd-btn bd-btn--ghost">
          Back to the console
        </Link>
      </div>
    </BdShell>
  );
}
