import { describe, expect, it } from 'vitest';
import {
  calculateCollaborationHistory,
  formatDuration,
  type CollaborationDealInput,
  type CollaborationEvidenceInput,
  type CollaborationStatusInput,
  type CollaborationVideoInput,
} from '@/lib/campaigns/insight-history';

const HOUR = 3_600_000;
const at = (hour: number) =>
  new Date(Date.UTC(2026, 8, 1) + hour * HOUR).toISOString();
const NOW = at(100);

function event(
  seq: number,
  kind: CollaborationEvidenceInput['kind'],
  hour: number,
  over: Partial<CollaborationEvidenceInput> = {}
): CollaborationEvidenceInput {
  return {
    id: `event-${seq}`,
    seq,
    kind,
    occurredAt: at(hour),
    submissionVersion: 1,
    actorRole: 'brand',
    reviewCycleId: null,
    revisionCategory: null,
    ...over,
  };
}

function video(
  events: CollaborationEvidenceInput[] = [],
  over: Partial<CollaborationVideoInput> = {}
): CollaborationVideoInput {
  return { id: 'video', historyCompleteness: 'complete', events, ...over };
}

function status(
  toStatus: CollaborationStatusInput['toStatus'],
  hour: number,
  fromStatus: CollaborationStatusInput['fromStatus'] = null
): CollaborationStatusInput {
  return { toStatus, fromStatus, createdAt: at(hour) };
}

function deal(
  over: Partial<CollaborationDealInput> = {}
): CollaborationDealInput {
  return {
    id: 'deal',
    creatorId: 'creator',
    status: 'pending',
    rightsAcceptedAt: null,
    events: [],
    videos: [],
    ...over,
  };
}

function calculate(deals: CollaborationDealInput[], now = NOW) {
  return calculateCollaborationHistory(deals, now).aggregate;
}

describe('collaboration denominators', () => {
  it('keeps absent denominators and duration observations unavailable', () => {
    const result = calculateCollaborationHistory([], NOW);
    expect(result.creators).toEqual([]);
    expect(result.aggregate.acceptance).toMatchObject({
      issued: 0,
      accepted: 0,
      rate: null,
    });
    expect(result.aggregate.completion.rate).toBeNull();
    expect(result.aggregate.dealRevisions.rate).toBeNull();
    expect(result.aggregate.videoRevisions.rate).toBeNull();
    expect(result.aggregate.approvalWithoutRevision.rate).toBeNull();
    for (const metric of Object.values(result.aggregate.timing)) {
      expect(metric).toEqual({
        medianMs: null,
        n: 0,
        samples: [],
        waiting: [],
        interrupted: [],
        excluded: 0,
      });
    }
  });

  it('counts all issued offers and acceptance surviving later statuses', () => {
    const statuses = [
      'pending',
      'declined',
      'expired',
      'accepted',
      'funded',
      'delivered',
      'revision_requested',
      'completed',
      'refunded',
    ] as const;
    const result = calculate(
      statuses.map((value) => deal({ id: value, status: value }))
    );
    expect(result.acceptance).toEqual({
      accepted: 6,
      issued: 9,
      pending: 1,
      declined: 1,
      expired: 1,
      rate: 6 / 9,
    });
    expect(result.completion).toEqual({
      completed: 1,
      funded: 5,
      inProgress: 3,
      refunded: 1,
      rate: 1 / 5,
    });
    expect(result.dealRevisions).toMatchObject({
      reviewed: 3,
      revised: 1,
      open: 2,
      closed: 1,
      revisedOpen: 1,
      revisedClosed: 0,
      unknownActorRevised: 1,
    });
  });

  it('uses rights acceptance and both ends of recorded status transitions', () => {
    const result = calculate([
      deal({ id: 'rights', rightsAcceptedAt: at(1) }),
      deal({ id: 'accepted-event', events: [status('accepted', 1)] }),
      deal({
        id: 'from-funded',
        status: 'refunded',
        events: [status('refunded', 2, 'funded')],
      }),
      deal({
        id: 'from-reviewed',
        status: 'refunded',
        events: [status('refunded', 2, 'revision_requested')],
      }),
    ]);
    expect(result.acceptance.accepted).toBe(4);
    expect(result.completion).toMatchObject({ funded: 2, refunded: 2 });
    expect(result.dealRevisions).toMatchObject({
      reviewed: 1,
      revised: 1,
      closed: 1,
      revisedClosed: 1,
    });
  });

  it('separates mixed admin, brand, and unattributed deal revisions', () => {
    const result = calculate([
      deal({
        status: 'completed',
        videos: [
          video([
            event(1, 'submitted', 1),
            event(2, 'revision_requested', 2, { actorRole: 'admin' }),
            event(3, 'submitted', 3, { submissionVersion: 2 }),
            event(4, 'revision_requested', 4, { submissionVersion: 2 }),
            event(5, 'submitted', 5, { submissionVersion: 3 }),
            event(6, 'revision_requested', 6, {
              submissionVersion: 3,
              actorRole: 'unknown',
            }),
            event(7, 'admin_release', 7, {
              submissionVersion: 3,
              actorRole: 'admin',
            }),
          ]),
        ],
      }),
    ]);
    expect(result.dealRevisions).toMatchObject({
      reviewed: 1,
      revised: 1,
      closed: 1,
      revisedClosed: 1,
      brandRevised: 1,
      adminRevised: 1,
      unknownActorRevised: 1,
      adminReleased: 1,
    });
    expect(result.approvalWithoutRevision).toMatchObject({
      approved: 0,
      adminReleased: 1,
      rate: null,
    });
  });

  it('keeps incidence per video distinct from rounds and pending review', () => {
    const result = calculate([
      deal({
        status: 'delivered',
        videos: [
          video([
            event(1, 'submitted', 1),
            event(2, 'revision_requested', 2),
            event(3, 'submitted', 3, { submissionVersion: 2 }),
            event(4, 'revision_requested', 4, { submissionVersion: 2 }),
            event(5, 'submitted', 5, { submissionVersion: 3 }),
            event(6, 'batch_approved', 6, { submissionVersion: 3 }),
          ]),
          video([event(7, 'submitted', 1), event(8, 'batch_approved', 2)], {
            id: 'unrevised',
          }),
          video(
            [
              event(9, 'submitted', 1),
              event(10, 'review_ready', 1, { reviewCycleId: 'pending' }),
            ],
            { id: 'pending' }
          ),
        ],
      }),
    ]);
    expect(result.videoRevisions).toMatchObject({
      revised: 1,
      reviewed: 2,
      rate: 0.5,
      rounds: 2,
      brandRounds: 2,
      adminRounds: 0,
      unknownActorRounds: 0,
    });
    expect(result.videoRevisions.perVideo.map((row) => row.rounds)).toEqual([
      2, 0, 0,
    ]);
    expect(result.approvalWithoutRevision).toMatchObject({
      approved: 2,
      withoutRevision: 1,
      rate: 0.5,
    });
  });

  it('excludes legacy and gapped histories without losing recorded feedback', () => {
    const result = calculate([
      deal({
        status: 'refunded',
        videos: [
          video(
            [
              event(1, 'legacy_baseline', 1, {
                submissionVersion: 0,
                actorRole: 'unknown',
                revisionCategory: 'other',
                metadata: { reviewStatus: 'rejected' },
              }),
              event(2, 'submitted', 2),
              event(3, 'revision_requested', 3, {
                revisionCategory: 'brand_requested_change',
                actorRole: 'admin',
              }),
              event(4, 'submitted', 4, { submissionVersion: 2 }),
              event(5, 'batch_approved', 5, { submissionVersion: 2 }),
            ],
            { historyCompleteness: 'legacy_baseline' }
          ),
          video(
            [
              event(6, 'submitted', 1),
              event(7, 'submitted', 2, { submissionVersion: 3 }),
              event(8, 'batch_approved', 3, { submissionVersion: 3 }),
            ],
            { id: 'gap' }
          ),
          video([event(9, 'batch_approved', 1)], { id: 'missing-start' }),
        ],
      }),
    ]);
    expect(result.videoRevisions).toMatchObject({
      reviewed: 0,
      revised: 0,
      excludedIncomplete: 3,
      rounds: 1,
      adminRounds: 1,
      rate: null,
    });
    expect(result.approvalWithoutRevision).toMatchObject({
      approved: 0,
      excludedIncomplete: 3,
      rate: null,
    });
    expect(
      result.revisionReasons.find((row) => row.category === 'unknown')
    ).toMatchObject({ count: 1, unknownActor: 1 });
    expect(
      result.revisionReasons.find(
        (row) => row.category === 'brand_requested_change'
      )
    ).toMatchObject({ count: 1, admin: 1 });
    expect(
      result.revisionReasons.find((row) => row.category === 'other')?.count
    ).toBe(0);
    // Known post-baseline endpoints remain useful, unlike missing earlier rounds.
    expect(result.timing.resubmission).toMatchObject({
      n: 1,
      medianMs: HOUR,
    });
  });

  it('retains unknown category and actor without inferring fault from feedback', () => {
    const result = calculate([
      deal({
        videos: [
          video([
            event(1, 'submitted', 1),
            event(2, 'revision_requested', 2, { actorRole: 'system' }),
            event(3, 'submitted', 3, { submissionVersion: 2 }),
            event(4, 'revision_requested', 4, {
              submissionVersion: 2,
              revisionCategory: 'brief_requirement',
            }),
          ]),
        ],
      }),
    ]);
    expect(result.revisionReasons).toHaveLength(7);
    expect(
      result.revisionReasons.find((row) => row.category === 'unknown')
    ).toMatchObject({ count: 1, unknownActor: 1 });
    expect(
      result.revisionReasons.find((row) => row.category === 'brief_requirement')
    ).toMatchObject({ count: 1, brand: 1 });
    expect(result.videoRevisions.unknownActorRounds).toBe(1);
  });

  it('does not mistake an admin release for ordinary reviewed-video approval', () => {
    const result = calculate([
      deal({
        status: 'completed',
        videos: [
          video([
            event(1, 'submitted', 1),
            event(2, 'admin_release', 2, { actorRole: 'admin' }),
          ]),
        ],
      }),
    ]);
    expect(result.videoRevisions.reviewed).toBe(0);
    expect(result.approvalWithoutRevision).toMatchObject({
      approved: 0,
      withoutRevision: 0,
      adminReleased: 1,
    });
  });
});

describe('funding to first full delivery', () => {
  it('ignores individual submissions and subsequent redeliveries', () => {
    const result = calculate([
      deal({
        status: 'completed',
        events: [
          status('delivered', 20),
          status('funded', 2),
          status('delivered', 10),
        ],
        videos: [video([event(1, 'submitted', 3)])],
      }),
    ]);
    expect(result.timing.firstFullDelivery).toMatchObject({
      n: 1,
      medianMs: 8 * HOUR,
      waiting: [],
    });
    expect(result.timing.firstFullDelivery.samples[0]).toMatchObject({
      startedAt: at(2),
      endedAt: at(10),
      videoId: null,
    });
  });

  it('shows ongoing partial delivery waiting separately from completed samples', () => {
    const metric = calculate([
      deal({
        status: 'funded',
        events: [status('funded', 1)],
        videos: [video([event(1, 'submitted', 2)])],
      }),
      deal({
        id: 'completed',
        status: 'completed',
        events: [status('funded', 1), status('delivered', 4)],
      }),
    ]).timing.firstFullDelivery;
    expect(metric).toMatchObject({ n: 1, medianMs: 3 * HOUR });
    expect(metric.waiting).toEqual([
      {
        dealId: 'deal',
        videoId: null,
        reviewCycleId: null,
        submissionVersion: null,
        startedAt: at(1),
        durationMs: 99 * HOUR,
      },
    ]);
  });

  it.each([
    { status: 'completed' as const, events: [] },
    { status: 'completed' as const, events: [status('delivered', 5)] },
    { status: 'completed' as const, events: [status('funded', 1)] },
    { status: 'refunded' as const, events: [status('funded', 1)] },
    {
      status: 'completed' as const,
      events: [status('funded', 5), status('delivered', 1)],
    },
    {
      status: 'completed' as const,
      events: [
        status('funded', 1),
        { ...status('delivered', 5), createdAt: 'invalid' },
        status('delivered', 10),
      ],
    },
    {
      status: 'funded' as const,
      events: [{ ...status('funded', 1), createdAt: 'invalid' }],
    },
    {
      status: 'completed' as const,
      events: [status('funded', 1), status('delivered', 101)],
    },
  ])('excludes missing, invalid, or backwards endpoints: %j', (input) => {
    expect(calculate([deal(input)]).timing.firstFullDelivery).toMatchObject({
      n: 0,
      medianMs: null,
      waiting: [],
      excluded: 1,
    });
  });
});

describe('review cycles and version-specific resubmission', () => {
  it('deduplicates multi-video readiness, decisions, and exact event duplicates', () => {
    const ready = event(3, 'review_ready', 2, { reviewCycleId: 'cycle' });
    const metric = calculate([
      deal({
        status: 'completed',
        videos: [
          video([
            event(1, 'submitted', 1),
            ready,
            ready,
            event(5, 'batch_approved', 5, { reviewCycleId: 'cycle' }),
          ]),
          video(
            [
              event(2, 'submitted', 2),
              event(4, 'review_ready', 2, { reviewCycleId: 'cycle' }),
              event(6, 'batch_approved', 5, { reviewCycleId: 'cycle' }),
            ],
            { id: 'sibling' }
          ),
        ],
      }),
    ]).timing.reviewDecision;
    expect(metric).toMatchObject({
      n: 1,
      medianMs: 3 * HOUR,
      excluded: 0,
      interrupted: [],
    });
  });

  it('preserves a revision decision despite sibling interruptions in its cycle', () => {
    const result = calculate([
      deal({
        status: 'revision_requested',
        videos: [
          video([
            event(1, 'submitted', 1),
            event(3, 'review_ready', 2, { reviewCycleId: 'cycle' }),
            event(5, 'revision_requested', 8, { reviewCycleId: 'cycle' }),
          ]),
          video(
            [
              event(2, 'submitted', 2),
              event(4, 'review_ready', 2, { reviewCycleId: 'cycle' }),
              event(6, 'review_interrupted', 8, { reviewCycleId: 'cycle' }),
            ],
            { id: 'sibling' }
          ),
        ],
      }),
    ]);
    expect(result.timing.reviewDecision).toMatchObject({
      n: 1,
      medianMs: 6 * HOUR,
      interrupted: [],
      waiting: [],
    });
    expect(result.timing.resubmission).toMatchObject({ n: 0, medianMs: null });
    expect(result.timing.resubmission.waiting[0]).toMatchObject({
      videoId: 'video',
      submissionVersion: 1,
      durationMs: 92 * HOUR,
    });
  });

  it('keeps true interrupted review windows out of completed and waiting samples', () => {
    const metric = calculate([
      deal({
        status: 'refunded',
        videos: [
          video([
            event(1, 'review_ready', 1, { reviewCycleId: 'cycle' }),
            event(2, 'review_interrupted', 3, {
              reviewCycleId: 'cycle',
              actorRole: 'admin',
            }),
            event(3, 'refunded', 3, { actorRole: 'admin' }),
          ]),
        ],
      }),
    ]).timing.reviewDecision;
    expect(metric).toMatchObject({ n: 0, medianMs: null, waiting: [] });
    expect(metric.interrupted).toHaveLength(1);
    expect(metric.interrupted[0]).toMatchObject({
      durationMs: 2 * HOUR,
      actorRole: 'admin',
    });
  });

  it('does not resurrect an interrupted cycle with a later decision', () => {
    const metric = calculate([
      deal({
        status: 'completed',
        videos: [
          video([
            event(1, 'review_ready', 1, { reviewCycleId: 'cycle' }),
            event(2, 'review_interrupted', 2, { reviewCycleId: 'cycle' }),
            event(3, 'batch_approved', 3, { reviewCycleId: 'cycle' }),
          ]),
        ],
      }),
    ]).timing.reviewDecision;
    expect(metric.n).toBe(0);
    expect(metric.interrupted[0].durationMs).toBe(HOUR);
  });

  it('shows only the latest still-open readiness cycle as waiting', () => {
    const metric = calculate([
      deal({
        status: 'delivered',
        videos: [
          video([
            event(1, 'review_ready', 1, { reviewCycleId: 'missing-end' }),
            event(2, 'review_ready', 5, { reviewCycleId: 'current' }),
          ]),
        ],
      }),
    ]).timing.reviewDecision;
    expect(metric).toMatchObject({ n: 0, excluded: 1 });
    expect(metric.waiting).toHaveLength(1);
    expect(metric.waiting[0]).toMatchObject({
      reviewCycleId: 'current',
      durationMs: 95 * HOUR,
    });
  });

  it('reports admin decision identity without counting it as batch approval', () => {
    const result = calculate([
      deal({
        status: 'completed',
        videos: [
          video([
            event(1, 'submitted', 1),
            event(2, 'review_ready', 2, { reviewCycleId: 'cycle' }),
            event(3, 'admin_release', 3, {
              reviewCycleId: 'cycle',
              actorRole: 'admin',
            }),
          ]),
        ],
      }),
    ]);
    expect(result.timing.reviewDecision.samples[0]).toMatchObject({
      actorRole: 'admin',
      durationMs: HOUR,
    });
    expect(result.approvalWithoutRevision.approved).toBe(0);
  });

  it('matches each rejected version to its immediate replacement, never another slot', () => {
    const result = calculate([
      deal({
        status: 'completed',
        videos: [
          video([
            event(7, 'submitted', 14, { submissionVersion: 3 }),
            event(5, 'revision_requested', 8, { submissionVersion: 2 }),
            event(1, 'submitted', 1),
            event(4, 'submitted', 5, { submissionVersion: 2 }),
            event(2, 'revision_requested', 2),
          ]),
          video([event(3, 'submitted', 3)], { id: 'other-slot' }),
        ],
      }),
    ]);
    expect(result.timing.resubmission).toMatchObject({
      n: 2,
      medianMs: 4.5 * HOUR,
    });
    expect(
      result.timing.resubmission.samples.map((sample) => [
        sample.submissionVersion,
        sample.durationMs,
      ])
    ).toEqual([
      [1, 3 * HOUR],
      [2, 6 * HOUR],
    ]);
  });

  it('excludes skipped versions, backwards timestamps, and wrong event order', () => {
    const metric = calculate([
      deal({
        status: 'revision_requested',
        videos: [
          video(
            [
              event(1, 'revision_requested', 1),
              event(2, 'submitted', 2, { submissionVersion: 3 }),
            ],
            { id: 'gap' }
          ),
          video(
            [
              event(3, 'revision_requested', 5),
              event(4, 'submitted', 3, { submissionVersion: 2 }),
            ],
            { id: 'clock-reversed' }
          ),
          video(
            [
              event(5, 'submitted', 5, { submissionVersion: 2 }),
              event(6, 'revision_requested', 3),
            ],
            { id: 'order-reversed' }
          ),
        ],
      }),
    ]).timing.resubmission;
    expect(metric).toMatchObject({
      n: 0,
      medianMs: null,
      excluded: 3,
      waiting: [],
    });
  });

  it('does not turn terminated or unknown resubmissions into ongoing waits', () => {
    const result = calculate([
      deal({
        status: 'refunded',
        videos: [video([event(1, 'revision_requested', 1)])],
      }),
      deal({
        id: 'unknown',
        status: 'delivered',
        videos: [video([event(2, 'revision_requested', 2)])],
      }),
    ]);
    expect(result.timing.resubmission).toMatchObject({
      n: 0,
      excluded: 2,
      waiting: [],
    });
  });

  it.each([
    [event(1, 'review_ready', 1)],
    [event(1, 'batch_approved', 1, { reviewCycleId: 'orphan' })],
    [event(1, 'review_ready', 1, { reviewCycleId: 'closed' })],
    [
      event(1, 'review_ready', 3, { reviewCycleId: 'backwards' }),
      event(2, 'batch_approved', 1, { reviewCycleId: 'backwards' }),
    ],
    [
      event(1, 'batch_approved', 3, { reviewCycleId: 'order' }),
      event(2, 'review_ready', 1, { reviewCycleId: 'order' }),
    ],
    [
      event(1, 'review_interrupted', 3, { reviewCycleId: 'order' }),
      event(2, 'review_ready', 1, { reviewCycleId: 'order' }),
    ],
  ])('excludes unpairable review history %#', (...events) => {
    expect(
      calculate([deal({ status: 'completed', videos: [video(events)] })]).timing
        .reviewDecision
    ).toMatchObject({ n: 0, medianMs: null, excluded: 1, waiting: [] });
  });

  it('does not manufacture baseline review or replacement timestamps', () => {
    const result = calculate([
      deal({
        status: 'refunded',
        videos: [
          video(
            [
              event(1, 'legacy_baseline', 5, {
                submissionVersion: 0,
                metadata: {
                  reviewStatus: 'rejected',
                  reviewedAt: at(4),
                  recordedSubmittedAt: at(1),
                },
              }),
              event(2, 'submitted', 6),
            ],
            { historyCompleteness: 'legacy_baseline' }
          ),
        ],
      }),
    ]);
    expect(result.timing.reviewDecision.n).toBe(0);
    expect(result.timing.resubmission.n).toBe(0);
    expect(result.dealRevisions).toMatchObject({ revised: 1, reviewed: 1 });
  });
});

describe('aggregation and serialization', () => {
  it('pools observations, not creator medians or rates, without mutating inputs', () => {
    const inputs = [
      deal({
        id: 'a1',
        creatorId: 'a',
        status: 'completed',
        events: [status('funded', 1), status('delivered', 2)],
      }),
      deal({
        id: 'a2',
        creatorId: 'a',
        status: 'completed',
        events: [status('funded', 1), status('delivered', 4)],
      }),
      deal({
        id: 'b1',
        creatorId: 'b',
        status: 'completed',
        events: [status('funded', 1), status('delivered', 81)],
      }),
      deal({ id: 'a3', creatorId: 'a' }),
    ];
    const before = JSON.stringify(inputs);
    const result = calculateCollaborationHistory(inputs, NOW);
    expect(result.creators.map((row) => row.creatorId)).toEqual(['a', 'b']);
    expect(result.creators[0].timing.firstFullDelivery.medianMs).toBe(2 * HOUR);
    expect(result.creators[1].timing.firstFullDelivery.medianMs).toBe(
      80 * HOUR
    );
    expect(result.aggregate.timing.firstFullDelivery).toMatchObject({
      n: 3,
      medianMs: 3 * HOUR,
    });
    expect(result.aggregate.acceptance.rate).toBe(3 / 4);
    expect(JSON.stringify(inputs)).toBe(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(calculateCollaborationHistory(inputs, NOW)).toEqual(result);
  });

  it('accepts a genuine same-instant observation but never substitutes zero for invalid now', () => {
    const inputs = [
      deal({
        status: 'completed',
        events: [status('funded', 1), status('delivered', 1)],
      }),
    ];
    expect(calculate(inputs).timing.firstFullDelivery).toMatchObject({
      medianMs: 0,
      n: 1,
    });
    expect(
      calculate(inputs, 'not-a-date').timing.firstFullDelivery
    ).toMatchObject({
      medianMs: null,
      n: 0,
      excluded: 1,
    });
  });

  it('excludes future and malformed open waits', () => {
    const result = calculate([
      deal({ status: 'funded', events: [status('funded', 101)] }),
      deal({
        id: 'review',
        status: 'delivered',
        videos: [
          video([
            event(1, 'review_ready', 1, {
              occurredAt: 'invalid',
              reviewCycleId: 'cycle',
            }),
          ]),
        ],
      }),
      deal({
        id: 'replacement',
        status: 'revision_requested',
        videos: [video([event(2, 'revision_requested', 101)])],
      }),
    ]);
    for (const metric of Object.values(result.timing)) {
      expect(metric.n).toBe(0);
      expect(metric.waiting).toEqual([]);
      expect(metric.excluded).toBeGreaterThan(0);
    }
  });
});

describe('formatDuration', () => {
  it.each([
    [null, 'Unavailable'],
    [Number.NaN, 'Unavailable'],
    [Number.POSITIVE_INFINITY, 'Unavailable'],
    [-1, 'Unavailable'],
    [0, '<1 min'],
    [59_999, '<1 min'],
    [60_000, '1 min'],
    [3_599_999, '59 min'],
    [HOUR, '1 hr'],
    [1.5 * HOUR, '1.5 hr'],
    [24 * HOUR, '1 d'],
    [60 * HOUR, '2.5 d'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });
});
