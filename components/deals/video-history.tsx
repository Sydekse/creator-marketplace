import type { VideoHistoryEvent } from '@/lib/deliverables/read-history';
import { formatDeadlineUtc } from '@/lib/dates';

/**
 * Every submitted version of one video, folded behind a ghost-pill
 * disclosure in the v4 grammar (KAN-157): version chapters with mono
 * timestamps on a hairline spine — the extension-history ledger's shape,
 * applied to submissions. Content and honesty notes are unchanged.
 */
export function VideoHistory({
  events,
  limited,
}: {
  events: VideoHistoryEvent[];
  limited: boolean;
}) {
  const versions = [...new Set(events.map((event) => event.submissionVersion))];
  return (
    <details className="bd-vhist">
      <summary>Version history</summary>
      {limited && (
        <p className="bd-vhist-note">
          Limited history: version 0 preserves the surviving legacy record, not
          the original submission. Earlier revisions are unknown.
        </p>
      )}
      <p className="bd-vhist-note">
        Reasons are reported feedback, not a determination of creator fault.
        Review is for the whole deal.
      </p>
      <ol className="bd-vhist-versions">
        {versions.map((version) => (
          <li key={version}>
            <h4 className="bd-vhist-vtitle">Version {version}</h4>
            <ol className="bd-agreelog">
              {events
                .filter((event) => event.submissionVersion === version)
                .map((event) => (
                  <li key={event.id}>
                    <p className="bd-agreelog-line">
                      <b>{event.label}</b> · {event.actorRole}
                    </p>
                    <time
                      className="bd-vhist-time bd-mono"
                      dateTime={event.occurredAt}
                    >
                      {formatDeadlineUtc(new Date(event.occurredAt))}
                    </time>
                    {(event.kind === 'submitted' ||
                      event.kind === 'legacy_baseline') && (
                      <p className="bd-agreelog-meta">
                        <a
                          href={event.tiktokUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bd-vhist-link"
                        >
                          Recorded TikTok link
                        </a>
                      </p>
                    )}
                    {event.categoryLabel && (
                      <p className="bd-agreelog-note">{event.categoryLabel}</p>
                    )}
                    {event.reviewLabel && (
                      <p className="bd-agreelog-meta">
                        Recorded review status: {event.reviewLabel}
                        {event.metadata.reviewedAt
                          ? ` · ${formatDeadlineUtc(new Date(event.metadata.reviewedAt))}`
                          : ''}
                      </p>
                    )}
                    {event.note && (
                      <p className="bd-agreelog-note">{event.note}</p>
                    )}
                    {event.metadata.recordedSubmittedAt && (
                      <p className="bd-agreelog-meta">
                        Recorded submission time:{' '}
                        {formatDeadlineUtc(
                          new Date(event.metadata.recordedSubmittedAt)
                        )}
                      </p>
                    )}
                    {event.metadata.metrics && (
                      <p className="bd-agreelog-meta">
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
