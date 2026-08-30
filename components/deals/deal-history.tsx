import {
  Check,
  Handshake,
  PaperPlaneTilt,
  SealCheck,
  VideoCamera,
  Wallet,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { SectionLabel } from '@/components/layout/section-label';
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
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-background px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {event.actor ? (
          <InitialsAvatar name={event.actor.name} size="sm" />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-neutral-900">
            {labelForStatus(event.toStatus)}
          </span>
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

/**
 * Every state transition this deal has been through (KAN-39, AC-5, NFR-012).
 *
 * The rail is the scan path: five icons for the usual walk, filled up to
 * where the deal stands. The list under it is still the audit trail — same
 * events, same labels, nothing re-sorted.
 *
 * The nodes borrow the deal-inbox's group colours: pending is amber, in-flight
 * is teal, delivered/awaiting is amber again, completed is green. Same words,
 * same colours — a deal reads the same on the inbox row and on its own page.
 */

/** Per-step accent, matching the inbox's GROUP_PILL tones. */
const STEP_TONE: Record<
  (typeof DEAL_PROGRESS_STEPS)[number],
  { bg: string; border: string; text: string }
> = {
  pending: {
    bg: 'bg-status-pending',
    border: 'border-status-pending-foreground/40',
    text: 'text-status-pending-foreground',
  },
  accepted: {
    bg: 'bg-brand-tint',
    border: 'border-brand/40',
    text: 'text-brand-ink',
  },
  funded: {
    bg: 'bg-brand-tint',
    border: 'border-brand/40',
    text: 'text-brand-ink',
  },
  delivered: {
    bg: 'bg-status-pending',
    border: 'border-status-pending-foreground/40',
    text: 'text-status-pending-foreground',
  },
  completed: {
    bg: 'bg-status-verified',
    border: 'border-status-verified-foreground/40',
    text: 'text-status-verified-foreground',
  },
};

function nodeClass(
  state: DealProgressState,
  step: (typeof DEAL_PROGRESS_STEPS)[number]
): string {
  if (state === 'done')
    return cn(STEP_TONE[step].bg, STEP_TONE[step].border, STEP_TONE[step].text);
  if (state === 'current')
    return cn(
      STEP_TONE[step].bg,
      STEP_TONE[step].border,
      STEP_TONE[step].text,
      'shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_18%,transparent)]'
    );
  if (state === 'blocked')
    return 'border-destructive bg-destructive/10 text-destructive';
  return 'border-neutral-200 bg-neutral-50 text-neutral-500';
}

/**
 * The progress rail, rendered for the deal's *current* status even before any
 * events exist (a pending deal has no history rows yet — the rail is how the
 * page shows step 1 lit rather than an empty aside).
 *
 * The track behind the nodes is the editorial part: a 2px hairline that fills
 * to the current step in that step's colour, so the rail reads as a bar, not
 * a row of circles.
 */
export function DealProgressRail({
  status,
  events,
}: {
  status: string;
  events: DealHistoryEvent[];
}) {
  const nodes = dealProgress(status, events);
  const fillTo = nodes.reduce((last, node, index) => {
    if (node.state === 'done' || node.state === 'current') return index;
    return last;
  }, 0);
  const span = Math.max(nodes.length - 1, 1);
  const fillWidth = `${(fillTo / span) * 100}%`;

  return (
    <div className="deal-progress">
      <div aria-hidden className="deal-progress-line">
        <div className="deal-progress-line-track">
          <div
            className="deal-progress-line-fill"
            style={{ width: fillWidth }}
          />
        </div>
      </div>

      <ol className="relative z-10 flex items-start">
        {nodes.map((node) => {
          const Icon = STEP_ICON[node.step];
          const blockedHere = node.state === 'blocked';
          return (
            <li
              key={node.step}
              className="flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              <span
                className={cn(
                  'deal-progress-node transition-colors duration-300',
                  nodeClass(node.state, node.step)
                )}
              >
                {blockedHere ? (
                  <X size={16} weight="bold" className="sm:size-6" />
                ) : node.state === 'done' ? (
                  <Check size={16} weight="bold" className="sm:size-6" />
                ) : (
                  <Icon size={16} weight="regular" className="sm:size-6" />
                )}
              </span>
              <span
                className={cn(
                  'max-w-full px-0.5 text-center text-[10px] leading-tight font-medium whitespace-nowrap sm:text-xs',
                  node.state === 'upcoming'
                    ? 'text-neutral-500'
                    : node.state === 'blocked'
                      ? 'text-destructive'
                      : node.state === 'current'
                        ? cn('font-semibold', STEP_TONE[node.step].text)
                        : 'text-neutral-800'
                )}
              >
                {blockedHere ? 'Stopped' : DEAL_PROGRESS_SHORT_LABEL[node.step]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DealHistory({ events }: { events: DealHistoryEvent[] }) {
  return (
    <section className="flex flex-col gap-5">
      <SectionLabel>{DEAL_HISTORY_TITLE}</SectionLabel>

      {events.length > 0 ? (
        <ol className="flex flex-col gap-2">
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
