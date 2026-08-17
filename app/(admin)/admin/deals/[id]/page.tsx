import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { DealHistory } from '@/components/deals/deal-history';
import { getDealHistory } from '@/lib/deals/queries';
import { ForbiddenError } from '@/lib/authz';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin deal drill-down (KAN-78): one deal's full event history.
 *
 * The read is `getDealHistory` with its default deps — the same read the
 * creator and brand pages use, whose `requireAccess` admits admins
 * (`allowAdmin: true`), so this page is the admin-facing window onto the
 * append-only `deal_event` trail (FR-007, NFR-012). The `(admin)` layout's
 * role gate and the read's own gate both apply.
 *
 * `getDealHistory` throws `ForbiddenError` for a malformed id (shape-checked
 * before the query, so a mistyped link is not a 500) and for a deal this
 * admin cannot see — which for an admin is no deal at all. A thrown
 * `ForbiddenError` on a nonexistent deal reads as a 404, not an oracle.
 */
export default async function AdminDealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ campaign?: string | string[] | undefined }>;
}) {
  const { id } = await params;
  // F2: the worklist links carry the campaign name so a drill-down has
  // context; a raw deep link (bookmark, pasted URL) still renders the trail,
  // just without the name — the read contract is untouched either way.
  const rawCampaign = (await searchParams).campaign;
  const campaignName =
    typeof rawCampaign === 'string' ? rawCampaign : undefined;

  let events;
  try {
    events = await getDealHistory(id);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/worklist"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Dispute worklist
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Deal history</h1>
        <p className="text-sm text-muted-foreground">
          {campaignName ? `Campaign: ${campaignName} — ` : ''}
          every state transition this deal has been through, oldest first — the
          append-only audit trail.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <DealHistory events={events} />
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
