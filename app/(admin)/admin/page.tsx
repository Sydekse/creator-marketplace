import Link from 'next/link';
import { Megaphone, Scale, ScrollText, Tag, UserCheck } from 'lucide-react';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { requireRole } from '@/lib/auth';
import { formatEtb } from '@/lib/money';
import {
  listCampaignsForAdmin,
  listWorklistForAdmin,
} from '@/lib/admin/overview';
import { countAwaitingTier } from '@/lib/creators/awaiting-tier';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

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
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Admin console"
        description={
          <div className="flex items-center gap-2">
            <InitialsAvatar name={user.name ?? user.email} size="sm" />
            <span>Signed in as {user.name ?? user.email}.</span>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/verification"
          className="group flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-card p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_32px_rgba(23,23,23,0.08)]"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors duration-300 ease-out group-hover:bg-neutral-900 group-hover:text-neutral-50">
            <UserCheck className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </span>
          <h2 className="font-semibold text-neutral-900">Verification queue</h2>
          <p className="text-sm text-muted-foreground">
            Review pending creator profiles
          </p>
        </Link>
        <Link
          href="/admin/campaigns"
          className="group flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-card p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_32px_rgba(23,23,23,0.08)]"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors duration-300 ease-out group-hover:bg-neutral-900 group-hover:text-neutral-50">
            <Megaphone className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">Campaigns</h2>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
              {campaigns.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Budgets, escrow held, payouts, commission and refunds
          </p>
        </Link>
        <Link
          href="/admin/worklist"
          className="group flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-card p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_32px_rgba(23,23,23,0.08)]"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors duration-300 ease-out group-hover:bg-neutral-900 group-hover:text-neutral-50">
            <Scale className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">Dispute worklist</h2>
            {disputed.length > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-neutral-50">
                {disputed.length}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Flagged or money-held deals awaiting resolution
          </p>
        </Link>
        <Link
          href="/admin/tiers"
          className="group flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-card p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_32px_rgba(23,23,23,0.08)]"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors duration-300 ease-out group-hover:bg-neutral-900 group-hover:text-neutral-50">
            <Tag className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">Awaiting tier</h2>
            {awaitingTier > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-neutral-50">
                {awaitingTier}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {awaitingTier > 0
              ? 'Verified creators with no price, so not bookable'
              : 'Every verified creator has a tier'}
          </p>
        </Link>
        <Link
          href="/admin/audit-log"
          className="group flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-card p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_32px_rgba(23,23,23,0.08)]"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors duration-300 ease-out group-hover:bg-neutral-900 group-hover:text-neutral-50">
            <ScrollText className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </span>
          <h2 className="font-semibold text-neutral-900">Audit log</h2>
          <p className="text-sm text-muted-foreground">
            Every admin action — the append-only trail
          </p>
        </Link>
      </div>

      {/* §9: Platform-wide money roll-up. The data is already fetched above —
          sum the campaigns array into aggregate totals rather than requiring a
          second read. Only shown when there is at least one campaign. */}
      {campaigns.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-card p-5">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Platform totals
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Held in escrow</dt>
              <dd className="font-mono text-sm font-medium">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.held, 0))}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Paid out</dt>
              <dd className="font-mono text-sm font-medium">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.paidOut, 0))}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Commission</dt>
              <dd className="font-mono text-sm font-medium">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.commission, 0))}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Refunded</dt>
              <dd className="font-mono text-sm font-medium">
                {formatEtb(campaigns.reduce((sum, c) => sum + c.refunded, 0))}
              </dd>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
