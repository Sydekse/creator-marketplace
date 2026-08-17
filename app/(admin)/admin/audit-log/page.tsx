import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { AUDIT_ACTIONS } from '@/lib/audit/actions';
import { readAuditLog } from '@/lib/audit/queries';
import type { AuditLogRow } from '@/lib/audit/queries';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin audit log (KAN-81, AC-031, FR-008).
 *
 * The console page the KAN-52 route comment anticipated: it calls
 * `readAuditLog` directly rather than the `/api/admin/audit-log` endpoint, so
 * the gate lives exactly where the query keeps it (inside `readAuditLog`, on
 * top of the `(admin)` layout's role gate). The endpoint stays for programmatic
 * access and filtering; this page is the human window onto the same read.
 *
 * Rendered newest first, one page at a time (the query's default). Actions are
 * shown as their human label with the raw `entity.verb` beside it, so the page
 * reads for a demo and stays faithful to the closed vocabulary for anyone who
 * filters.
 */
const ACTION_LABELS: Record<string, string> = {
  [AUDIT_ACTIONS.CREATOR_VERIFY]: 'Creator verified',
  [AUDIT_ACTIONS.CREATOR_REJECT]: 'Creator rejected',
  [AUDIT_ACTIONS.CREATOR_ASSIGN_TIER]: 'Tier assigned',
  [AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE]: 'Dispute resolved',
  [AUDIT_ACTIONS.DEAL_FLAG]: 'Deal flagged',
  [AUDIT_ACTIONS.METRIC_EDIT]: 'Metrics edited',
};

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  return typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
}

export default async function AdminAuditLogPage() {
  const page = await readAuditLog();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Admin console
        </Link>
        <PageHeader
          title="Audit log"
          description={
            <>
              Every admin action, append-only — who did what, and when. Showing
              the latest {page.rows.length}
              {page.hasMore ? ' — older entries are a page behind' : ''}.
            </>
          }
        />
      </div>

      {page.rows.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          description="Admin actions will appear here as they happen."
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
          {page.rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditRow({ row }: { row: AuditLogRow }) {
  const label = ACTION_LABELS[row.action] ?? row.action;
  const actor = row.actorName ?? row.actorEmail ?? row.actorId;
  const detail = formatDetail(row.detail);

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {label}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {row.action}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(row.createdAt)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {actor} · {row.targetType}
          <span className="font-mono">:{row.targetId}</span>
        </p>
      </div>
      {detail !== '' && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          {detail}
        </pre>
      )}
    </li>
  );
}
