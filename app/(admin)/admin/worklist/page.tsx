import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { FlagDealButton } from '@/components/admin/flag-deal-button';
import { listWorklistForAdmin } from '@/lib/admin/overview';
import { formatEtb } from '@/lib/money';
import { ResolveDisputeForm } from '@/components/admin/resolve-dispute-form';

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
 */
export default async function AdminWorklistPage() {
  const worklist = await listWorklistForAdmin();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dispute worklist"
        description="Deals that are flagged, or whose money is held and unresolved. Resolving refunds the brand, releases to the creator, or requests a revision — and clears the attention flag."
      />

      {worklist.length === 0 ? (
        <EmptyState
          title="Nothing awaiting resolution"
          description="Every deal is either resolved, or money is not held on it."
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
        <ul className="flex flex-col gap-4">
          {worklist.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-neutral-200 bg-card p-5 transition-all duration-300 ease-out hover:border-neutral-300"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-neutral-900">
                      {row.campaignName}
                    </h2>
                    {row.flagged && <Chip tone="red">Flagged</Chip>}
                  </div>
                  <div className="flex items-center gap-2">
                    <InitialsAvatar name={row.brandCompanyName} size="sm" />
                    <InitialsAvatar name={row.creatorHandle} size="sm" />
                    <p className="text-sm text-muted-foreground">
                      {row.brandCompanyName} · @{row.creatorHandle} ·{' '}
                      {row.videoCount} video{row.videoCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {row.status} · {formatEtb(row.totalPrice)} held
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
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
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    View deal history
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
