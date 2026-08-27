import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  AUDIT_ACTION_VALUES,
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  AUDIT_TARGET_TYPE_VALUES,
} from '@/lib/audit/actions';
import { AUDIT_PARAM_ALIASES, readAuditLog } from '@/lib/audit/queries';
import type { AuditLogRow } from '@/lib/audit/queries';
import { PAGE_SIZE, offsetForPage, pageFromParam } from '@/lib/paging';
import { readParams, searchParamsFrom } from '@/lib/query-params';
import { auditLogQuerySchema } from '@/lib/validation';
import { cn, textLinkFeedback } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin audit log (KAN-81, KAN-94, AC-031, FR-008).
 *
 * The console page the KAN-52 route comment anticipated: it calls `readAuditLog`
 * directly rather than the `/api/admin/audit-log` endpoint, so the gate lives
 * exactly where the query keeps it (inside `readAuditLog`, on top of the
 * `(admin)` layout's role gate). The endpoint stays for programmatic access;
 * this page is the human window onto the same read.
 *
 * **Filters live in the URL, not in component state** — the discovery page's
 * pattern, and for its reasons: a Server Component re-runs its query when the
 * query string changes, a filtered view is shareable and bookmarkable, and the
 * whole screen ships no client JavaScript. The form is a plain
 * `<form method="GET">` over native `<select>`/`<input>`, which is how a browser
 * writes to the URL. It reads the same `auditLogQuerySchema` and
 * `AUDIT_PARAM_ALIASES` the endpoint does, so the page and the route cannot
 * drift into accepting different filters (AC-031: actor, action, target, date
 * range).
 *
 * Rendered newest first, one page at a time, with `?page=` paging that retains
 * the active filters — otherwise page 2 would silently widen the view back to
 * the whole log.
 */
const ACTION_LABELS: Record<string, string> = {
  [AUDIT_ACTIONS.CREATOR_VERIFY]: 'Creator verified',
  [AUDIT_ACTIONS.CREATOR_REJECT]: 'Creator rejected',
  [AUDIT_ACTIONS.CREATOR_ASSIGN_TIER]: 'Tier assigned',
  [AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE]: 'Dispute resolved',
  [AUDIT_ACTIONS.DEAL_FLAG]: 'Deal flagged',
  [AUDIT_ACTIONS.METRIC_EDIT]: 'Metrics edited',
};

/** The raw table names read as prose in the filter, not as columns. */
const TARGET_TYPE_LABELS: Record<string, string> = {
  [AUDIT_TARGET_TYPES.CREATOR_PROFILE]: 'Creator profile',
  [AUDIT_TARGET_TYPES.DEAL]: 'Deal',
  [AUDIT_TARGET_TYPES.VIDEO_METRIC]: 'Video metric',
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

/**
 * A `Date` back to the `yyyy-mm-dd` an `<input type="date">` wants.
 *
 * The bound was coerced from a date-only string, so its UTC calendar day is the
 * one the admin typed (invariant 11 — the whole app reasons in UTC), and slicing
 * the ISO string round-trips it without a second timezone entering the picture.
 */
function toDateInputValue(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 10) : '';
}

const inputClass =
  'h-11 rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors hover:border-neutral-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** Rendered when the URL's filters cannot be parsed — the discovery precedent. */
function UnreadableFilters() {
  return (
    <EmptyState
      align="start"
      title="Those filters could not be read."
      description="The link may be mistyped or out of date. Clear the filters and try again."
      action={
        <Link
          href="/admin/audit-log"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Clear filters
        </Link>
      }
    />
  );
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = searchParamsFrom(await searchParams);

  // Paging is not filtering, so `page` is taken out before the filter schema
  // sees the query string — `.strict()` would otherwise reject it as unknown.
  const page = pageFromParam(search.get('page') ?? undefined);
  search.delete('page');

  const { params, conflicts } = readParams(search, AUDIT_PARAM_ALIASES);
  const parsed = auditLogQuerySchema.safeParse(params);

  // A page cannot answer 422, but on this table of all tables it must not answer
  // a *mistyped* filter with the whole log either — that reads as an
  // authoritative "here is everything actor X did" when the filter was dropped.
  // Saying the filters were unreadable is the honest version of the same 422.
  if (conflicts.length > 0 || !parsed.success) {
    return (
      <div className="flex flex-col gap-10">
        <Masthead />
        <UnreadableFilters />
      </div>
    );
  }

  const filters = parsed.data;

  // `?page=` is the only paging control; a hand-added `?limit=`/`?offset=` in the
  // URL is overridden here so the pager math and the page size stay in agreement.
  const result = await readAuditLog({
    ...filters,
    limit: PAGE_SIZE,
    offset: offsetForPage(page),
  });

  const hasActiveFilters =
    filters.actorId !== undefined ||
    filters.action !== undefined ||
    filters.targetType !== undefined ||
    filters.targetId !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined;

  // Carried onto the pager links so paging keeps the filters — otherwise page 2
  // silently widens the view back to the whole log.
  const filterQuery = search.toString();
  const pageHref = (n: number) =>
    `/admin/audit-log?${filterQuery ? `${filterQuery}&` : ''}page=${n}`;

  return (
    <div className="flex flex-col gap-10">
      <Masthead />

      <form
        method="GET"
        action="/admin/audit-log"
        className="flex flex-col gap-5 rounded-[24px] border border-neutral-200 bg-neutral-100/45 p-5 sm:p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Action</span>
            <select
              name="action"
              defaultValue={filters.action ?? ''}
              className={inputClass}
            >
              <option value="">Any action</option>
              {AUDIT_ACTION_VALUES.map((action) => (
                <option key={action} value={action}>
                  {ACTION_LABELS[action] ?? action}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Target type</span>
            <select
              name="target_type"
              defaultValue={filters.targetType ?? ''}
              className={inputClass}
            >
              <option value="">Any target</option>
              {AUDIT_TARGET_TYPE_VALUES.map((type) => (
                <option key={type} value={type}>
                  {TARGET_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </label>

          {/* The two id filters are free text because an id is what an admin
              copies out of a row above — "everything this actor did" starts from
              an actor id already on the screen. Validated as a uuid by the schema,
              so a mistyped one is an unreadable-filters state, not a 500. */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Actor ID</span>
            <input
              type="text"
              name="actor_id"
              inputMode="text"
              placeholder="Any actor"
              defaultValue={filters.actorId ?? ''}
              className={`${inputClass} font-mono`}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Target ID</span>
            <input
              type="text"
              name="target_id"
              inputMode="text"
              placeholder="Any target"
              defaultValue={filters.targetId ?? ''}
              className={`${inputClass} font-mono`}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">From</span>
            <input
              type="date"
              name="from"
              defaultValue={toDateInputValue(filters.from)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">To</span>
            <input
              type="date"
              name="to"
              defaultValue={toDateInputValue(filters.to)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            Apply filters
          </button>
          {/* A link, not a reset button: clearing means navigating to the
              unfiltered URL, and `type="reset"` would only restore the inputs
              while leaving the query string — and the results — untouched. */}
          <Link
            href="/admin/audit-log"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Clear
          </Link>
        </div>
      </form>

      {result.rows.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            align="start"
            title="No entries match these filters"
            description="Try widening the date range, or clear the filters to see the whole trail."
            action={
              <Link
                href="/admin/audit-log"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            align="start"
            title="No audit entries yet"
            description="Admin actions will appear here as they happen."
            action={
              <Link
                href="/admin"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Back to the console
              </Link>
            }
          />
        )
      ) : (
        <ul className="border-y border-neutral-200">
          {result.rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {(page > 1 || result.hasMore) && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {result.rows.length > 0
              ? `Showing ${offsetForPage(page) + 1}–${offsetForPage(page) + result.rows.length}`
              : `Nothing on page ${page}`}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Previous
              </Link>
            )}
            {result.hasMore && (
              <Link
                href={pageHref(page + 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The back link and page opener, shared by the normal and unreadable states. */
function Masthead() {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/admin"
        className={cn('text-sm text-muted-foreground', textLinkFeedback)}
      >
        ← Admin console
      </Link>
      <PageHeader
        label="Admin"
        title="Audit log"
        description="Review who acted, what changed, and when. Filter by action, actor, target, or date range."
      />
    </div>
  );
}

function AuditRow({ row }: { row: AuditLogRow }) {
  const label = ACTION_LABELS[row.action] ?? row.action;
  const actor = row.actorName ?? row.actorEmail ?? row.actorId;
  const detail = formatDetail(row.detail);

  return (
    <li className="border-b border-neutral-200 px-1 py-5 transition-colors duration-300 last:border-b-0 hover:bg-neutral-100/60 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="gray">{label}</Chip>
            <span className="font-mono text-xs text-muted-foreground">
              {row.action}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {actor} · {row.targetType}
            <span className="font-mono">:{row.targetId}</span>
          </p>
        </div>
        <time className="font-mono text-xs text-muted-foreground sm:text-right">
          {formatTimestamp(row.createdAt)}
        </time>
      </div>
      {detail !== '' && (
        <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100/65 p-3 font-mono text-xs text-neutral-600">
          {detail}
        </pre>
      )}
    </li>
  );
}
