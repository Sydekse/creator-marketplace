import Link from 'next/link';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { FlagDealButton } from '@/components/admin/flag-deal-button';
import { listWorklistForAdmin } from '@/lib/admin/overview';
import { ageLabel } from '@/lib/dates';
import { formatEtb } from '@/lib/money';
import { ResolveDisputeForm } from '@/components/admin/resolve-dispute-form';
import { displayTiktokHandle } from '@/lib/creators/handle';
import { cn, textLinkFeedback } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin dispute worklist (KAN-51, AC-030; KAN-60 flow 6).
 *
 * Renders `lib/admin/overview.ts`'s `listWorklistForAdmin` — the flagged-or-
 * refundable union (KAN-69 F40) — server-side, with a resolve form per row.
 * The read embeds its own admin gate on top of the `(admin)` layout's role
 * gate, so a 403 is impossible to reach even if the layout gate is bypassed.
 *
 * A resolution POSTs to the existing `/api/admin/deals/{id}/resolve` endpoint
 * (validation, ledger, audit) and refreshes; the resolved row leaves the
 * list, which is the confirmation the page needs — no extra state.
 *
 * v4 conversion: shared admin shell plus compact worklist rows; dispute forms
 * and action endpoints are untouched.
 */
export default async function AdminWorklistPage() {
  const worklist = await listWorklistForAdmin();

  return (
    <BdShell className="bd-ad bd-ad-worklist">
      <BdPageHead
        eyebrow="Admin console"
        title="Dispute worklist"
        facts={
          <>
            <span className="bd-mono">{worklist.length}</span> held-funds rows ·
            resolve, refund, or keep in revision.
          </>
        }
        ruled
      />

      {worklist.length === 0 ? (
        <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5.5h10" />
              <path d="M8.5 5.5v12" />
              <path d="M15.5 5.5v12" />
              <path d="M5 17.5h14" />
              <path d="M9 9.5l-3 4h6z" />
              <path d="M15 9.5l-3 4h6z" />
            </svg>
            <h3>Nothing awaiting resolution</h3>
            <p>Every deal is either resolved, or money is not held on it.</p>
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
            <span className="bd-caprulertitle">Resolution queue</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulercount bd-mono">
              {worklist.length} {worklist.length === 1 ? 'deal' : 'deals'}
            </span>
          </div>
          <ul className="bd-ad-list">
            {worklist.map((row) => (
              <li key={row.id} className="bd-ad-workrow bd-ad-workrow--wait">
                <div className="bd-ad-workgrid">
                  <div className="bd-ad-workmain">
                    <div className="bd-ad-worktitle">
                      <h2>{row.campaignName}</h2>
                      {row.flagged && <Chip tone="red">Flagged</Chip>}
                    </div>
                    <div className="bd-ad-avatarline">
                      <InitialsAvatar name={row.brandCompanyName} size="sm" />
                      <InitialsAvatar
                        name={row.creatorHandle}
                        image={row.creatorImage}
                        size="sm"
                      />
                      <p>
                        {row.brandCompanyName} ·{' '}
                        {displayTiktokHandle(row.creatorHandle)} ·{' '}
                        {row.videoCount} video{row.videoCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="bd-ad-muted">
                      {row.status} ·{' '}
                      <span className="bd-mono">
                        {formatEtb(row.totalPrice)}
                      </span>{' '}
                      held · {ageLabel(row.createdAt)}
                    </p>
                  </div>
                  <div className="bd-ad-workactions">
                    <ResolveDisputeForm
                      dealId={row.id}
                      status={row.status}
                      campaignName={row.campaignName}
                    />
                    <FlagDealButton
                      dealId={row.id}
                      campaignName={row.campaignName}
                      flagged={row.flagged}
                    />
                    <Link
                      href={`/admin/deals/${row.id}?campaign=${encodeURIComponent(row.campaignName)}`}
                      className={cn('bd-ad-link', textLinkFeedback)}
                    >
                      View deal history
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BdShell>
  );
}
