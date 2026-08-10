import { formatDeadlineUtc } from '@/lib/dates';
import {
  DEAL_HISTORY_EMPTY,
  DEAL_HISTORY_TITLE,
  SYSTEM_ACTOR_LABEL,
} from '@/lib/deals/detail';
import { labelForStatus } from '@/lib/deals/groups';
import type { DealHistoryEvent } from '@/lib/deals/queries';

/**
 * Every state transition this deal has been through (KAN-39, AC-5, NFR-012).
 *
 * A server component reading rows `getDealHistory` already ordered oldest-first
 * and already folded — nothing here sorts, and nothing computes. `deal_event` is
 * append-only (invariant 5), so this is the deal's actual audit trail rather
 * than a reconstruction from its current status.
 *
 * Shown to the creator, not just kept for admins. A creator who is told "your
 * offer expired" is entitled to see when it was sent and when it lapsed, and
 * that is the whole reason FR-007 writes an event per transition.
 *
 * **A null actor is the system acting**, never a blank name. `toHistoryEvent`
 * collapses a missing actor to `null` precisely so a caller cannot render an
 * empty string where the honest answer is that nobody clicked anything — the
 * expiry sweep (KAN-38) is the case that produces these.
 */

function Event({ event }: { event: DealHistoryEvent }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{labelForStatus(event.toStatus)}</span>
        {/* The reason is the useful half of a rejection or a dispute
            resolution, and it is nullable for every ordinary transition. */}
        {event.reason ? (
          <span className="text-xs text-muted-foreground">{event.reason}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {event.actor ? event.actor.name : SYSTEM_ACTOR_LABEL}
        </span>
      </div>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {formatDeadlineUtc(event.createdAt)}
      </span>
    </li>
  );
}

export function DealHistory({ events }: { events: DealHistoryEvent[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
        {DEAL_HISTORY_TITLE}
      </h2>

      {events.length > 0 ? (
        <ol className="divide-y divide-border">
          {events.map((event) => (
            <Event key={event.id} event={event} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{DEAL_HISTORY_EMPTY}</p>
      )}
    </section>
  );
}
