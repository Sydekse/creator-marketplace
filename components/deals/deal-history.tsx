import {
  Check,
  Handshake,
  PaperPlaneTilt,
  SealCheck,
  VideoCamera,
  Wallet,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { formatDeadlineUtc } from '@/lib/dates';
import {
  DEAL_HISTORY_EMPTY,
  DEAL_HISTORY_TITLE,
  SYSTEM_ACTOR_LABEL,
} from '@/lib/deals/detail';
import { labelForStatus } from '@/lib/deals/groups';
import {
  DEAL_PROGRESS_SHORT_LABEL,
  DEAL_PROGRESS_STEPS,
  dealProgress,
  isBlockedDealStatus,
  type DealProgressState,
} from '@/lib/deals/progress';
import type { DealHistoryEvent } from '@/lib/deals/queries';
import { cn } from '@/lib/utils';

/**
 * Every state transition this deal has been through (KAN-39, AC-5, NFR-012).
 *
 * The rail is the scan path: five icons for the usual walk, filled up to
 * where the deal stands. The list under it is still the audit trail — same
 * events, same labels, nothing re-sorted.
 */

const STEP_ICON = {
  pending: PaperPlaneTilt,
  accepted: Handshake,
  funded: Wallet,
  delivered: VideoCamera,
  completed: SealCheck,
} as const;

function Event({ event }: { event: DealHistoryEvent }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {event.actor ? (
          <InitialsAvatar name={event.actor.name} size="sm" />
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">{labelForStatus(event.toStatus)}</span>
          {event.reason ? (
            <span className="text-xs text-muted-foreground">
              {event.reason}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {event.actor ? event.actor.name : SYSTEM_ACTOR_LABEL}
          </span>
        </div>
      </div>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {formatDeadlineUtc(event.createdAt)}
      </span>
    </li>
  );
}

function nodeClass(state: DealProgressState): string {
  switch (state) {
    case 'done':
      return 'border-brand bg-brand text-neutral-50';
    case 'current':
      return 'border-brand bg-brand-tint text-brand-ink shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_18%,transparent)]';
    case 'blocked':
      return 'border-destructive bg-destructive/10 text-destructive';
    default:
      return 'border-neutral-200 bg-neutral-50 text-neutral-400';
  }
}

function ProgressRail({
  current,
  events,
}: {
  current: string;
  events: DealHistoryEvent[];
}) {
  const nodes = dealProgress(current, events);

  return (
    <ol className="flex items-start gap-0">
      {nodes.map((node, index) => {
        const Icon = STEP_ICON[node.step];
        const blockedHere = node.state === 'blocked';
        return (
          <li
            key={node.step}
            className="flex min-w-0 flex-1 flex-col items-center gap-2"
          >
            <div className="flex w-full items-center">
              <span
                aria-hidden
                className={cn(
                  'h-px flex-1',
                  index === 0
                    ? 'bg-transparent'
                    : node.state === 'upcoming'
                      ? 'bg-neutral-200'
                      : 'bg-brand'
                )}
              />
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full border',
                  nodeClass(node.state)
                )}
              >
                {blockedHere ? (
                  <X size={16} weight="bold" />
                ) : node.state === 'done' ? (
                  <Check size={16} weight="bold" />
                ) : (
                  <Icon size={16} weight="bold" />
                )}
              </span>
              <span
                aria-hidden
                className={cn(
                  'h-px flex-1',
                  index === DEAL_PROGRESS_STEPS.length - 1
                    ? 'bg-transparent'
                    : node.state === 'done'
                      ? 'bg-brand'
                      : 'bg-neutral-200'
                )}
              />
            </div>
            <span
              className={cn(
                'max-w-full px-0.5 text-center text-[10px] leading-tight font-medium whitespace-nowrap sm:text-[11px]',
                node.state === 'upcoming'
                  ? 'text-neutral-400'
                  : node.state === 'blocked'
                    ? 'text-destructive'
                    : 'text-neutral-800'
              )}
            >
              {blockedHere ? 'Stopped' : DEAL_PROGRESS_SHORT_LABEL[node.step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function DealHistory({ events }: { events: DealHistoryEvent[] }) {
  const current = events.at(-1)?.toStatus ?? '';

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
        {DEAL_HISTORY_TITLE}
      </h2>

      {events.length > 0 ? (
        <>
          <div className="rounded-[24px] border border-neutral-200 bg-gradient-to-br from-brand-tint/70 via-neutral-50 to-neutral-50 px-2 py-5 sm:px-4">
            <ProgressRail current={current} events={events} />
            {isBlockedDealStatus(current) ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                This deal stopped at {labelForStatus(current)}.
              </p>
            ) : current === 'revision_requested' ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Changes requested — replace the video to move on.
              </p>
            ) : null}
          </div>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase marker:content-none hover:text-neutral-700">
              <span
                aria-hidden
                className="transition-transform group-open:rotate-90"
              >
                ▸
              </span>
              Timeline
            </summary>
            <ol className="mt-2 divide-y divide-border">
              {events.map((event) => (
                <Event key={event.id} event={event} />
              ))}
            </ol>
          </details>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{DEAL_HISTORY_EMPTY}</p>
      )}
    </section>
  );
}
