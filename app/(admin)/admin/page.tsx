import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listWorklistForAdmin } from '@/lib/admin/overview';
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name ?? user.email}.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/verification"
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
        >
          <h2 className="font-semibold">Verification queue</h2>
          <p className="text-sm text-muted-foreground">
            Review pending creator profiles
          </p>
        </Link>
        <Link
          href="/admin/worklist"
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Dispute worklist</h2>
            {disputed.length > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-white">
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
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Awaiting tier</h2>
            {awaitingTier > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-white">
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
      </div>
    </div>
  );
}
