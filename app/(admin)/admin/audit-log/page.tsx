import Link from 'next/link';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { Chip } from '@/components/ui/chip';
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
 *
 * v4 conversion: filters, empty states, rows, and pager now sit inside the
 * admin console `.bd` shell without changing URL/query semantics.
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

const inputClass = 'bd-ad-input';

/** Rendered when the URL's filters cannot be parsed — the discovery precedent. */
function UnreadableFilters() {
  return (
    <div className="bd-emptyfeed">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h14v14H5z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
        <path d="M16 16l3 3" />
      </svg>
      <h3>Those filters could not be read.</h3>
      <p>
        The link may be mistyped or out of date. Clear the filters and try
        again.
      </p>
      <Link href="/admin/audit-log" className="bd-btn bd-btn--ghost">
        Clear filters
      </Link>
    </div>
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
      <BdShell className="bd-ad bd-ad-audit">
        <Masthead />
        <UnreadableFilters />
      </BdShell>
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
    <BdShell className="bd-ad bd-ad-audit">
      <Masthead />

      <form
        method="GET"
        action="/admin/audit-log"
        className="bd-ad-filter bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <div className="bd-ad-filtergrid">
          <label className="bd-ad-field">
            <span>Action</span>
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

          <label className="bd-ad-field">
            <span>Target type</span>
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
          <label className="bd-ad-field">
            <span>Actor ID</span>
            <input
              type="text"
              name="actor_id"
              inputMode="text"
              placeholder="Any actor"
              defaultValue={filters.actorId ?? ''}
              className={`${inputClass} bd-mono`}
            />
          </label>

          <label className="bd-ad-field">
            <span>Target ID</span>
            <input
              type="text"
              name="target_id"
              inputMode="text"
              placeholder="Any target"
              defaultValue={filters.targetId ?? ''}
              className={`${inputClass} bd-mono`}
            />
          </label>

          <label className="bd-ad-field">
            <span>From</span>
            <input
              type="date"
              name="from"
              defaultValue={toDateInputValue(filters.from)}
              className={inputClass}
            />
          </label>

          <label className="bd-ad-field">
            <span>To</span>
            <input
              type="date"
              name="to"
              defaultValue={toDateInputValue(filters.to)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="bd-ad-filteractions">
          <button type="submit" className="bd-btn bd-btn--primary">
            Apply filters
          </button>
          {/* A link, not a reset button: clearing means navigating to the
              unfiltered URL, and `type="reset"` would only restore the inputs
              while leaving the query string — and the results — untouched. */}
          <Link href="/admin/audit-log" className="bd-btn bd-btn--ghost">
            Clear
          </Link>
        </div>
      </form>

      <section
        className="bd-ad-section bd-rise"
        style={{ '--i': 3 } as React.CSSProperties}
      >
        <div className="bd-capruler">
          <span className="bd-caprulertitle">Trail</span>
          <span className="bd-caprulerline" aria-hidden="true" />
          <span className="bd-caprulercount bd-mono">
            {result.rows.length}{' '}
            {result.rows.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {result.rows.length === 0 ? (
          hasActiveFilters ? (
            <div className="bd-emptyfeed">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5h14v14H5z" />
                <path d="M8 9h8" />
                <path d="M8 13h5" />
                <path d="M15 15l4 4" />
              </svg>
              <h3>No entries match these filters</h3>
              <p>
                Try widening the date range, or clear the filters to see the
                whole trail.
              </p>
              <Link href="/admin/audit-log" className="bd-btn bd-btn--ghost">
                Clear filters
              </Link>
            </div>
          ) : (
            <div className="bd-emptyfeed">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4.5h12v15H6z" />
                <path d="M9 8h6" />
                <path d="M9 11.5h6" />
                <path d="M9 15h3" />
              </svg>
              <h3>No audit entries yet</h3>
              <p>Admin actions will appear here as they happen.</p>
              <Link href="/admin" className="bd-btn bd-btn--ghost">
                Back to the console
              </Link>
            </div>
          )
        ) : (
          <ul className="bd-ad-list">
            {result.rows.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      {(page > 1 || result.hasMore) && (
        <div className="bd-ad-pager">
          <p>
            {result.rows.length > 0
              ? `Showing ${offsetForPage(page) + 1}–${offsetForPage(page) + result.rows.length}`
              : `Nothing on page ${page}`}
          </p>
          <div>
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="bd-btn bd-btn--ghost">
                Previous
              </Link>
            )}
            {result.hasMore && (
              <Link href={pageHref(page + 1)} className="bd-btn bd-btn--ghost">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </BdShell>
  );
}

/** The back link and page opener, shared by the normal and unreadable states. */
function Masthead({ count }: { count?: number } = {}) {
  return (
    <div className="bd-ad-mast">
      <Link href="/admin" className={cn('bd-cdback', textLinkFeedback)}>
        ← Admin console
      </Link>
      <BdPageHead
        eyebrow="Admin console"
        title="Audit log"
        facts={
          count === undefined ? (
            'Review who acted, what changed, and when.'
          ) : (
            <>
              <span className="bd-mono">{count}</span> entries on this page ·
              filter by action, actor, target, or date.
            </>
          )
        }
        ruled
        rise={1}
      />
    </div>
  );
}

function AuditRow({ row }: { row: AuditLogRow }) {
  const label = ACTION_LABELS[row.action] ?? row.action;
  const actor = row.actorName ?? row.actorEmail ?? row.actorId;
  const detail = formatDetail(row.detail);

  return (
    <li className="bd-ad-auditrow">
      <div className="bd-ad-auditgrid">
        <div className="bd-ad-auditmain">
          <div className="bd-ad-auditlabels">
            <Chip tone="gray">{label}</Chip>
            <span className="bd-mono">{row.action}</span>
          </div>
          <p>
            {actor} · {row.targetType}
            <span className="bd-mono">:{row.targetId}</span>
          </p>
        </div>
        <time className="bd-mono">{formatTimestamp(row.createdAt)}</time>
      </div>
      {detail !== '' && (
        <pre className="bd-ad-auditdetail bd-mono">{detail}</pre>
      )}
    </li>
  );
}
