import type { VideoHistoryEvent } from '@/lib/deliverables/read-history';
import { formatDeadlineUtc } from '@/lib/dates';

export function VideoHistory({
  events,
  limited,
}: {
  events: VideoHistoryEvent[];
  limited: boolean;
}) {
  const versions = [...new Set(events.map((event) => event.submissionVersion))];
  return (
    <details className="min-w-0 text-sm">
      <summary className="cursor-pointer rounded-sm py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
        Version history
      </summary>
      {limited && (
        <p className="text-muted-foreground">
          Limited history: version 0 preserves the surviving legacy record, not
          the original submission. Earlier revisions are unknown.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Reasons are reported feedback, not a determination of creator fault.
        Review is for the whole deal.
      </p>
      <ol className="flex flex-col gap-4 py-3">
        {versions.map((version) => (
          <li key={version} className="flex min-w-0 flex-col gap-2">
            <h4 className="font-medium">Version {version}</h4>
            <ol className="flex flex-col gap-3 border-l pl-3">
              {events
                .filter((event) => event.submissionVersion === version)
                .map((event) => (
                  <li key={event.id} className="flex min-w-0 flex-col gap-1">
                    <p>
                      {event.label} · {event.actorRole}
                    </p>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={event.occurredAt}
                    >
                      {formatDeadlineUtc(new Date(event.occurredAt))}
                    </time>
                    {(event.kind === 'submitted' ||
                      event.kind === 'legacy_baseline') && (
                      <a
                        href={event.tiktokUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all underline underline-offset-4"
                      >
                        Recorded TikTok link
                      </a>
                    )}
                    {event.categoryLabel && <p>{event.categoryLabel}</p>}
                    {event.reviewLabel && (
                      <p className="text-xs text-muted-foreground">
                        Recorded review status: {event.reviewLabel}
                        {event.metadata.reviewedAt
                          ? ` · ${formatDeadlineUtc(new Date(event.metadata.reviewedAt))}`
                          : ''}
                      </p>
                    )}
                    {event.note && (
                      <p className="whitespace-pre-wrap break-words">
                        {event.note}
                      </p>
                    )}
                    {event.metadata.recordedSubmittedAt && (
                      <p className="text-xs text-muted-foreground">
                        Recorded submission time:{' '}
                        {formatDeadlineUtc(
                          new Date(event.metadata.recordedSubmittedAt)
                        )}
                      </p>
                    )}
                    {event.metadata.metrics && (
                      <p className="text-xs text-muted-foreground">
                        Prior latest metrics ({event.metadata.metrics.source}{' '}
                        reported): views{' '}
                        {event.metadata.metrics.views ?? 'unknown'}, likes{' '}
                        {event.metadata.metrics.likes ?? 'unknown'}, comments{' '}
                        {event.metadata.metrics.comments ?? 'unknown'}, shares{' '}
                        {event.metadata.metrics.shares ?? 'unknown'}. Last
                        record update:{' '}
                        {event.metadata.metrics.lastUpdatedAt
                          ? formatDeadlineUtc(
                              new Date(event.metadata.metrics.lastUpdatedAt)
                            )
                          : 'unknown'}
                        . Preserved at replacement, not a metric time series.
                      </p>
                    )}
                  </li>
                ))}
            </ol>
          </li>
        ))}
      </ol>
    </details>
  );
}
