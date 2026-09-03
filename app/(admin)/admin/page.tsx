import Link from 'next/link';
import { Megaphone, Scales, Scroll, Tag } from '@phosphor-icons/react/dist/ssr';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { requireRole } from '@/lib/auth';
import { formatEtb } from '@/lib/money';
import {
  listCampaignsForAdmin,
  listWorklistForAdmin,
} from '@/lib/admin/overview';
import { countAwaitingTier } from '@/lib/creators/awaiting-tier';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin console overview — v4 shell conversion for the operational queues and
 * platform money roll-up; data reads remain unchanged.
 */
export default async function AdminConsolePage() {
  const user = await requireRole('admin');

  // KAN-23, AC-5. A creator who matched no tier is verified, invisible to
  // discovery, and on no other screen — so the console has to say how many there
  // are, or the only person who ever learns about them is whoever happened to be
  // looking at the toast when they were approved.
  const awaitingTier = await countAwaitingTier();

  // KAN-51 AC-030: the disputed/refundable worklist count — the one number an
  // admin should see without a click, because money is sitting on every row.
  const disputed = await listWorklistForAdmin();

  // KAN-78: the campaign count is the read layer's own list — the console card
  // links to it, and the number is the same query the list page runs.
  const campaigns = await listCampaignsForAdmin();

  return (
    <BdShell className="bd-ad bd-ad-console">
      <BdPageHead
        eyebrow="Admin console"
        title="Admin console"
        facts={
          <span className="bd-ad-userline">
            <InitialsAvatar
              name={user.name ?? user.email}
              image={user.image}
              size="sm"
            />
            <span>
              Signed in as {user.name ?? user.email}.{' '}
              <span className="bd-mono">{campaigns.length}</span> campaigns ·{' '}
              <span className="bd-mono">{disputed.length}</span> disputes ·{' '}
              <span className="bd-mono">{awaitingTier}</span> awaiting tier
            </span>
          </span>
        }
        ruled
      />

      <dl
        className="bd-cdfacts bd-ad-consolefacts bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-cdfact">
          <dt className="bd-cdfactlab">Campaigns</dt>
          <dd className="bd-cdfactval bd-mono">{campaigns.length}</dd>
        </div>
        <div className="bd-cdfact">
          <dt className="bd-cdfactlab">Needs resolution</dt>
          <dd className="bd-cdfactval bd-mono">{disputed.length}</dd>
        </div>
        <div className="bd-cdfact">
          <dt className="bd-cdfactlab">Awaiting tier</dt>
          <dd className="bd-cdfactval bd-mono">{awaitingTier}</dd>
        </div>
      </dl>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Operational queues</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulernote">
            Review people, money, and exceptions
          </span>
        </div>
        <div className="bd-ad-queues">
          <Link href="/admin/campaigns" className="bd-ad-tile">
            <span className="bd-ad-icon">
              <Megaphone className="h-4 w-4" weight="regular" aria-hidden />
            </span>
            <div className="bd-ad-tilehead">
              <h2>Campaigns</h2>
              <span className="bd-ad-count bd-mono">{campaigns.length}</span>
            </div>
            <p>Budgets, escrow held, payouts, commission and refunds</p>
          </Link>
          <Link href="/admin/worklist" className="bd-ad-tile">
            <span className="bd-ad-icon">
              <Scales className="h-4 w-4" weight="regular" aria-hidden />
            </span>
            <div className="bd-ad-tilehead">
              <h2>Dispute worklist</h2>
              {disputed.length > 0 && (
                <span className="bd-capstatus bd-capstatus--wait bd-mono">
                  {disputed.length}
                </span>
              )}
            </div>
            <p>Flagged or money-held deals awaiting resolution</p>
          </Link>
          <Link href="/admin/tiers" className="bd-ad-tile">
            <span className="bd-ad-icon">
              <Tag className="h-4 w-4" weight="regular" aria-hidden />
            </span>
            <div className="bd-ad-tilehead">
              <h2>Awaiting tier</h2>
              {awaitingTier > 0 && (
                <span className="bd-capstatus bd-capstatus--wait bd-mono">
                  {awaitingTier}
                </span>
              )}
            </div>
            <p>
              {awaitingTier > 0
                ? 'Verified creators with no price, so not bookable'
                : 'Every verified creator has a tier'}
            </p>
          </Link>
          <Link href="/admin/audit-log" className="bd-ad-tile">
            <span className="bd-ad-icon">
              <Scroll className="h-4 w-4" weight="regular" aria-hidden />
            </span>
            <h2>Audit log</h2>
            <p>Trace every administrative action in chronological order.</p>
          </Link>
        </div>
      </section>

      {/* §9: Platform-wide money roll-up. The data is already fetched above —
          sum the campaigns array into aggregate totals rather than requiring a
          second read. Only shown when there is at least one campaign. */}
      {campaigns.length > 0 && (
        <section
          className="bd-ad-section bd-rise"
          style={{ '--i': 3 } as React.CSSProperties}
        >
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Platform totals</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulernote">Ledger-derived sums</span>
          </div>
          <dl className="bd-caprail bd-ad-totals">
            <div className="bd-railcell">
              <dt className="bd-railk">Held in escrow</dt>
              <dd className="bd-railv bd-mono">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.held, 0))}
              </dd>
            </div>
            <div className="bd-railcell">
              <dt className="bd-railk">Paid out</dt>
              <dd className="bd-railv bd-mono">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.paidOut, 0))}
              </dd>
            </div>
            <div className="bd-railcell">
              <dt className="bd-railk">Commission</dt>
              <dd className="bd-railv bd-mono">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.commission, 0))}
              </dd>
            </div>
            <div className="bd-railcell">
              <dt className="bd-railk">Refunded</dt>
              <dd className="bd-railv bd-mono">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.refunded, 0))}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </BdShell>
  );
}
