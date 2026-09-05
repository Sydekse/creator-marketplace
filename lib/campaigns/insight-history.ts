import type { DealStatus } from '@/db/schema';
import {
  REVISION_CATEGORIES,
  REVISION_CATEGORY_LABELS,
  type DeliverableEventKind,
  type EvidenceMetadata,
  type RevisionCategory,
} from '@/lib/deliverables/evidence';

export type HistoryActorRole =
  'brand' | 'creator' | 'admin' | 'system' | 'unknown';

export interface CollaborationEvidenceInput {
  id: string;
  seq: number;
  kind: DeliverableEventKind;
  submissionVersion: number;
  actorRole: HistoryActorRole;
  occurredAt: string;
  reviewCycleId: string | null;
  revisionCategory: RevisionCategory | null;
  metadata?: EvidenceMetadata;
}

export interface CollaborationVideoInput {
  id: string;
  historyCompleteness: 'complete' | 'legacy_baseline';
  events: readonly CollaborationEvidenceInput[];
}

export interface CollaborationStatusInput {
  fromStatus: DealStatus | null;
  toStatus: DealStatus;
  createdAt: string;
}

export interface CollaborationDealInput {
  id: string;
  creatorId: string;
  status: DealStatus;
  rightsAcceptedAt: string | null;
  events: readonly CollaborationStatusInput[];
  videos: readonly CollaborationVideoInput[];
}

export interface HistoryDurationSample {
  dealId: string;
  videoId: string | null;
  reviewCycleId: string | null;
  submissionVersion: number | null;
  actorRole: HistoryActorRole;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface HistoryWaiting {
  dealId: string;
  videoId: string | null;
  reviewCycleId: string | null;
  submissionVersion: number | null;
  startedAt: string;
  durationMs: number;
}

export interface HistoryDuration {
  medianMs: number | null;
  n: number;
  samples: HistoryDurationSample[];
  waiting: HistoryWaiting[];
  interrupted: HistoryDurationSample[];
  excluded: number;
}

export interface HistoryRevisionReason {
  category: RevisionCategory | 'unknown';
  label: string;
  count: number;
  brand: number;
  admin: number;
  unknownActor: number;
}

export interface HistoryVideoRounds {
  dealId: string;
  videoId: string;
  historyCompleteness: CollaborationVideoInput['historyCompleteness'];
  fullyCaptured: boolean;
  rounds: number;
  brand: number;
  admin: number;
  unknownActor: number;
}

export interface CollaborationSummary {
  acceptance: {
    accepted: number;
    issued: number;
    pending: number;
    declined: number;
    expired: number;
    rate: number | null;
  };
  completion: {
    completed: number;
    funded: number;
    inProgress: number;
    refunded: number;
    rate: number | null;
  };
  dealRevisions: {
    revised: number;
    reviewed: number;
    open: number;
    closed: number;
    revisedOpen: number;
    revisedClosed: number;
    brandRevised: number;
    adminRevised: number;
    unknownActorRevised: number;
    adminReleased: number;
    rate: number | null;
  };
  videoRevisions: {
    revised: number;
    reviewed: number;
    excludedIncomplete: number;
    rounds: number;
    brandRounds: number;
    adminRounds: number;
    unknownActorRounds: number;
    perVideo: HistoryVideoRounds[];
    rate: number | null;
  };
  approvalWithoutRevision: {
    withoutRevision: number;
    approved: number;
    excludedIncomplete: number;
    adminReleased: number;
    rate: number | null;
  };
  revisionReasons: HistoryRevisionReason[];
  timing: {
    firstFullDelivery: HistoryDuration;
    reviewDecision: HistoryDuration;
    resubmission: HistoryDuration;
  };
}

export interface CreatorCollaborationHistory extends CollaborationSummary {
  creatorId: string;
}

export interface CollaborationHistory {
  creators: CreatorCollaborationHistory[];
  aggregate: CollaborationSummary;
}

const FUNDED: readonly DealStatus[] = [
  'funded',
  'delivered',
  'revision_requested',
  'completed',
  'refunded',
];
const ACCEPTED: readonly DealStatus[] = ['accepted', ...FUNDED];
const REVIEWED: readonly DealStatus[] = [
  'delivered',
  'revision_requested',
  'completed',
];
const DECISIONS: readonly DeliverableEventKind[] = [
  'revision_requested',
  'batch_approved',
  'admin_release',
];
const isClosed = (status: DealStatus) =>
  status === 'completed' || status === 'refunded';
const rate = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null;

function duration(): HistoryDuration {
  return {
    medianMs: null,
    n: 0,
    samples: [],
    waiting: [],
    interrupted: [],
    excluded: 0,
  };
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsed(start: string, end: string, now: string): number | null {
  const a = timestamp(start);
  const b = timestamp(end);
  const limit = timestamp(now);
  return a !== null && b !== null && limit !== null && b >= a && b <= limit
    ? b - a
    : null;
}

type IntervalContext = Pick<
  HistoryDurationSample,
  'dealId' | 'videoId' | 'reviewCycleId' | 'submissionVersion'
>;

function recordInterval(
  metric: HistoryDuration,
  context: IntervalContext,
  start: string,
  end: string,
  now: string,
  actorRole: HistoryActorRole = 'unknown',
  interrupted = false
) {
  const durationMs = elapsed(start, end, now);
  if (durationMs === null) {
    metric.excluded++;
    return;
  }
  const sample = {
    ...context,
    startedAt: start,
    endedAt: end,
    durationMs,
    actorRole,
  };
  (interrupted ? metric.interrupted : metric.samples).push(sample);
}

function recordWaiting(
  metric: HistoryDuration,
  context: IntervalContext,
  start: string,
  now: string
) {
  const durationMs = elapsed(start, now, now);
  if (durationMs === null) metric.excluded++;
  else metric.waiting.push({ ...context, startedAt: start, durationMs });
}

function orderedEvidence(video: CollaborationVideoInput) {
  return [
    ...new Map(video.events.map((event) => [event.id, event])).values(),
  ].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}

function fullyCaptured(
  video: CollaborationVideoInput,
  history: CollaborationEvidenceInput[]
) {
  if (
    video.historyCompleteness !== 'complete' ||
    history.some((event) => event.kind === 'legacy_baseline')
  )
    return false;
  const versions = new Set(
    history
      .filter((event) => event.kind === 'submitted')
      .map((event) => event.submissionVersion)
  );
  const highest = Math.max(
    0,
    ...history.map((event) => event.submissionVersion)
  );
  return (
    highest > 0 &&
    versions.size === highest &&
    [...versions].every((version) => Number.isInteger(version) && version >= 1)
  );
}

function ever(deal: CollaborationDealInput, statuses: readonly DealStatus[]) {
  return (
    statuses.includes(deal.status) ||
    deal.events.some(
      (event) =>
        statuses.includes(event.toStatus) ||
        (event.fromStatus !== null && statuses.includes(event.fromStatus))
    )
  );
}

function firstStatus(deal: CollaborationDealInput, status: DealStatus) {
  const events = deal.events.filter((event) => event.toStatus === status);
  // A corrupt timestamp cannot be skipped in favor of a later, plausible
  // "first" event: that would silently change the observation.
  if (events.some((event) => timestamp(event.createdAt) === null)) return null;
  return (
    events.sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    )[0] ?? null
  );
}

function firstDelivery(
  deal: CollaborationDealInput,
  metric: HistoryDuration,
  now: string
) {
  if (!ever(deal, FUNDED)) return;
  const start = firstStatus(deal, 'funded');
  const end = firstStatus(deal, 'delivered');
  const context: IntervalContext = {
    dealId: deal.id,
    videoId: null,
    reviewCycleId: null,
    submissionVersion: null,
  };
  if (!start) metric.excluded++;
  else if (end)
    recordInterval(metric, context, start.createdAt, end.createdAt, now);
  else if (
    deal.status === 'funded' &&
    !deal.events.some((event) => event.toStatus === 'delivered')
  )
    recordWaiting(metric, context, start.createdAt, now);
  else metric.excluded++;
}

function reviewTiming(
  deal: CollaborationDealInput,
  events: CollaborationEvidenceInput[],
  metric: HistoryDuration,
  now: string
) {
  const cycles = new Map<string, CollaborationEvidenceInput[]>();
  for (const event of events) {
    if (event.reviewCycleId) {
      const cycle = cycles.get(event.reviewCycleId) ?? [];
      cycle.push(event);
      cycles.set(event.reviewCycleId, cycle);
    } else if (event.kind === 'review_ready') metric.excluded++;
  }
  for (const [reviewCycleId, cycle] of cycles) {
    const start = cycle.find((event) => event.kind === 'review_ready');
    const decision = cycle.find((event) => DECISIONS.includes(event.kind));
    const interruption = cycle.find(
      (event) => event.kind === 'review_interrupted'
    );
    if (!start) {
      if (decision || interruption) metric.excluded++;
      continue;
    }
    const context: IntervalContext = {
      dealId: deal.id,
      videoId: null,
      reviewCycleId,
      submissionVersion: null,
    };
    // A revision decision is followed by interruptions for its siblings in
    // the same transaction. Those rows do not erase the recorded decision.
    if (decision && (!interruption || decision.seq < interruption.seq)) {
      if (decision.seq < start.seq) metric.excluded++;
      else
        recordInterval(
          metric,
          context,
          start.occurredAt,
          decision.occurredAt,
          now,
          decision.actorRole
        );
    } else if (interruption) {
      if (interruption.seq < start.seq) metric.excluded++;
      else
        recordInterval(
          metric,
          context,
          start.occurredAt,
          interruption.occurredAt,
          now,
          interruption.actorRole,
          true
        );
    } else if (
      deal.status === 'delivered' &&
      !events.some(
        (event) =>
          event.kind === 'review_ready' &&
          event.reviewCycleId !== reviewCycleId &&
          event.seq > start.seq
      )
    )
      recordWaiting(metric, context, start.occurredAt, now);
    else metric.excluded++;
  }
}

function replacementTiming(
  deal: CollaborationDealInput,
  video: CollaborationVideoInput,
  events: CollaborationEvidenceInput[],
  metric: HistoryDuration,
  now: string
) {
  for (const rejection of events.filter(
    (event) => event.kind === 'revision_requested'
  )) {
    const context: IntervalContext = {
      dealId: deal.id,
      videoId: video.id,
      reviewCycleId: rejection.reviewCycleId,
      submissionVersion: rejection.submissionVersion,
    };
    const replacement = events.find(
      (event) =>
        event.kind === 'submitted' &&
        event.submissionVersion === rejection.submissionVersion + 1
    );
    if (replacement) {
      if (replacement.seq < rejection.seq) metric.excluded++;
      else
        recordInterval(
          metric,
          context,
          rejection.occurredAt,
          replacement.occurredAt,
          now,
          rejection.actorRole
        );
    } else if (
      !isClosed(deal.status) &&
      deal.status === 'revision_requested' &&
      !events.some(
        (event) =>
          event.submissionVersion > rejection.submissionVersion ||
          (DECISIONS.includes(event.kind) && event.seq > rejection.seq)
      )
    )
      recordWaiting(metric, context, rejection.occurredAt, now);
    else metric.excluded++;
  }
}

function summarize(
  deals: readonly CollaborationDealInput[],
  now: string
): CollaborationSummary {
  const summary: CollaborationSummary = {
    acceptance: {
      accepted: 0,
      issued: deals.length,
      pending: 0,
      declined: 0,
      expired: 0,
      rate: null,
    },
    completion: {
      completed: 0,
      funded: 0,
      inProgress: 0,
      refunded: 0,
      rate: null,
    },
    dealRevisions: {
      revised: 0,
      reviewed: 0,
      open: 0,
      closed: 0,
      revisedOpen: 0,
      revisedClosed: 0,
      brandRevised: 0,
      adminRevised: 0,
      unknownActorRevised: 0,
      adminReleased: 0,
      rate: null,
    },
    videoRevisions: {
      revised: 0,
      reviewed: 0,
      excludedIncomplete: 0,
      rounds: 0,
      brandRounds: 0,
      adminRounds: 0,
      unknownActorRounds: 0,
      perVideo: [],
      rate: null,
    },
    approvalWithoutRevision: {
      withoutRevision: 0,
      approved: 0,
      excludedIncomplete: 0,
      adminReleased: 0,
      rate: null,
    },
    revisionReasons: [...REVISION_CATEGORIES, 'unknown' as const].map(
      (category) => ({
        category,
        label:
          category === 'unknown'
            ? 'Unknown / legacy feedback'
            : REVISION_CATEGORY_LABELS[category],
        count: 0,
        brand: 0,
        admin: 0,
        unknownActor: 0,
      })
    ),
    timing: {
      firstFullDelivery: duration(),
      reviewDecision: duration(),
      resubmission: duration(),
    },
  };
  for (const deal of deals) {
    const events = deal.videos
      .flatMap(orderedEvidence)
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    const revisions = events.filter(
      (event) => event.kind === 'revision_requested'
    );
    const legacyRejections = events.filter(
      (event) =>
        event.kind === 'legacy_baseline' &&
        event.metadata?.reviewStatus === 'rejected'
    );
    const approvedByAdmin = events.some(
      (event) => event.kind === 'admin_release'
    );
    const revised =
      ever(deal, ['revision_requested']) ||
      revisions.length > 0 ||
      legacyRejections.length > 0;
    const reviewed =
      revised ||
      ever(deal, REVIEWED) ||
      events.some(
        (event) =>
          event.kind === 'review_ready' || DECISIONS.includes(event.kind)
      );
    if (deal.rightsAcceptedAt !== null || ever(deal, ACCEPTED))
      summary.acceptance.accepted++;
    if (deal.status === 'pending') summary.acceptance.pending++;
    if (deal.status === 'declined') summary.acceptance.declined++;
    if (deal.status === 'expired') summary.acceptance.expired++;
    if (ever(deal, FUNDED)) {
      summary.completion.funded++;
      if (deal.status === 'completed') summary.completion.completed++;
      else if (deal.status === 'refunded') summary.completion.refunded++;
      else summary.completion.inProgress++;
    }
    if (reviewed) {
      const revision = summary.dealRevisions;
      revision.reviewed++;
      revision[isClosed(deal.status) ? 'closed' : 'open']++;
      if (revised) {
        revision.revised++;
        revision[isClosed(deal.status) ? 'revisedClosed' : 'revisedOpen']++;
        if (revisions.some((event) => event.actorRole === 'brand'))
          revision.brandRevised++;
        if (revisions.some((event) => event.actorRole === 'admin'))
          revision.adminRevised++;
        if (
          legacyRejections.length ||
          !revisions.length ||
          revisions.some(
            (event) =>
              event.actorRole !== 'brand' && event.actorRole !== 'admin'
          )
        )
          revision.unknownActorRevised++;
      }
    }
    if (approvedByAdmin) summary.dealRevisions.adminReleased++;
    for (const feedback of [...revisions, ...legacyRejections]) {
      const category =
        feedback.kind === 'legacy_baseline'
          ? 'unknown'
          : (feedback.revisionCategory ?? 'unknown');
      const reason = summary.revisionReasons.find(
        (row) => row.category === category
      )!;
      reason.count++;
      reason[
        feedback.actorRole === 'brand' || feedback.actorRole === 'admin'
          ? feedback.actorRole
          : 'unknownActor'
      ]++;
    }
    for (const video of deal.videos) {
      const history = orderedEvidence(video);
      const requests = history.filter(
        (event) => event.kind === 'revision_requested'
      );
      const complete = fullyCaptured(video, history);
      const reviewedVideo = history.some(
        (event) =>
          event.kind === 'revision_requested' || event.kind === 'batch_approved'
      );
      const batchApproved = history.some(
        (event) => event.kind === 'batch_approved'
      );
      const adminReleased = history.some(
        (event) => event.kind === 'admin_release'
      );
      const rounds: HistoryVideoRounds = {
        dealId: deal.id,
        videoId: video.id,
        historyCompleteness: video.historyCompleteness,
        fullyCaptured: complete,
        rounds: requests.length,
        brand: requests.filter((event) => event.actorRole === 'brand').length,
        admin: requests.filter((event) => event.actorRole === 'admin').length,
        unknownActor: requests.filter(
          (event) => event.actorRole !== 'brand' && event.actorRole !== 'admin'
        ).length,
      };
      summary.videoRevisions.perVideo.push(rounds);
      summary.videoRevisions.rounds += rounds.rounds;
      summary.videoRevisions.brandRounds += rounds.brand;
      summary.videoRevisions.adminRounds += rounds.admin;
      summary.videoRevisions.unknownActorRounds += rounds.unknownActor;
      if (!complete) summary.videoRevisions.excludedIncomplete++;
      else if (reviewedVideo) {
        summary.videoRevisions.reviewed++;
        if (requests.length) summary.videoRevisions.revised++;
      }
      if (adminReleased) summary.approvalWithoutRevision.adminReleased++;
      if (batchApproved) {
        if (!complete) summary.approvalWithoutRevision.excludedIncomplete++;
        else if (!adminReleased) {
          summary.approvalWithoutRevision.approved++;
          if (!requests.length)
            summary.approvalWithoutRevision.withoutRevision++;
        }
      }
      replacementTiming(deal, video, history, summary.timing.resubmission, now);
    }
    firstDelivery(deal, summary.timing.firstFullDelivery, now);
    reviewTiming(deal, events, summary.timing.reviewDecision, now);
  }
  summary.acceptance.rate = rate(
    summary.acceptance.accepted,
    summary.acceptance.issued
  );
  summary.completion.rate = rate(
    summary.completion.completed,
    summary.completion.funded
  );
  summary.dealRevisions.rate = rate(
    summary.dealRevisions.revised,
    summary.dealRevisions.reviewed
  );
  summary.videoRevisions.rate = rate(
    summary.videoRevisions.revised,
    summary.videoRevisions.reviewed
  );
  summary.approvalWithoutRevision.rate = rate(
    summary.approvalWithoutRevision.withoutRevision,
    summary.approvalWithoutRevision.approved
  );
  for (const metric of Object.values(summary.timing)) {
    const values = metric.samples
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    metric.n = values.length;
    const middle = Math.floor(values.length / 2);
    metric.medianMs = values.length
      ? values.length % 2
        ? values[middle]
        : values[middle - 1] / 2 + values[middle] / 2
      : null;
  }
  return summary;
}

/** Callers must supply only the viewing brand's deals for displayed creators. */
export function calculateCollaborationHistory(
  deals: readonly CollaborationDealInput[],
  now: string
): CollaborationHistory {
  const byCreator = new Map<string, CollaborationDealInput[]>();
  for (const deal of deals) {
    const rows = byCreator.get(deal.creatorId) ?? [];
    rows.push(deal);
    byCreator.set(deal.creatorId, rows);
  }
  return {
    creators: [...byCreator].map(([creatorId, rows]) => ({
      creatorId,
      ...summarize(rows, now),
    })),
    aggregate: summarize(deals, now),
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'Unavailable';
  if (ms < 60_000) return '<1 min';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Number((ms / 3_600_000).toFixed(1))} hr`;
  return `${Number((ms / 86_400_000).toFixed(1))} d`;
}
