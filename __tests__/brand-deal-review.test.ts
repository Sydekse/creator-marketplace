import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { LEGAL_TRANSITIONS, canReview } from '../lib/deals/state-machine';
import {
  ALREADY_REVIEWED_MESSAGE,
  AWAITING_DELIVERABLE_MESSAGE,
  AWAITING_REMAINING_VIDEOS_MESSAGE,
  AWAITING_RESUBMISSION_MESSAGE,
  DELIVERABLES_TITLE,
  NO_RIGHTS_TERMS_MESSAGE,
  REJECTION_REASON_LABEL,
  buildBrandDealWhere,
  deliveryProgress,
  externalRefundNote,
  readBrandDeal,
  reviewAbsenceMessage,
  standingVideoCount,
  videoHeading,
} from '../lib/deals/brand-detail';
import type {
  BrandDealDeps,
  BrandDealJoinRow,
  BrandDeliverableView,
} from '../lib/deals/brand-detail';
import {
  APPROVE_DELIVERABLE_LABEL,
  REJECT_DELIVERABLE_LABEL,
  REJECT_REASON_HINT,
  approveConfirmMessage,
} from '../lib/deals/copy';
import { labelForReviewStatus, labelForStatus } from '../lib/deals/groups';
import type { DealStatus, ReviewStatus } from '../db/schema';

/**
 * KAN-68 — the brand reviews a delivered deal and approves or rejects it
 * (US-008, AC-023, AC-024, and KAN-35's orphaned AC-6), as amended by **F38**.
 *
 * Wave 12 shipped both endpoints with nothing that could reach them: no brand
 * deal surface existed, and the delivery notification's CTA landed on
 * `/campaigns`, which showed neither the video nor a control. So every claim in
 * this file is about *reachability* as much as correctness — the loop's
 * second-to-last link having a button at all.
 *
 * Five things carry the weight.
 *
 * **The read gates itself, before it looks at its arguments.** `readBrandDeal`
 * calls `guard` first and takes the brand id from its answer, never from a
 * parameter, so a caller cannot ask for somebody else's deal. The `deps` seam is
 * what lets the suite prove the query never ran for a denied caller rather than
 * merely that it returned nothing — and, since F38, that the deal's *videos* are
 * never fetched for a deal the caller does not own.
 *
 * **Every kind of miss is the same miss.** A malformed id, an unknown id and a
 * real deal on another brand's campaign all answer `null` and land on the same
 * not-found page. Distinguishing them would make the URL an existence oracle for
 * deal ids (Tech Spec §6.3) — `readCreatorDetail`'s rule, applied to the other
 * side of the deal.
 *
 * **Approval is per deal and rejection is per video** (F38), because their
 * subjects differ. AC-023 releases "the held funds for **that deal**" against one
 * hold, so there is one Approve however many videos it covers; a rejection has to
 * name which of three videos to redo or the reason is useless. That asymmetry is
 * why `ReviewActions` became two components.
 *
 * **The controls are derived from the state machine, not from a status literal.**
 * `canReview` reads `LEGAL_TRANSITIONS`, so an edge removed from the table removes
 * the buttons from the screen in the same edit. And because a deal only reaches
 * `delivered` once every video it was paid for is in, the Approve button cannot
 * appear over a partial delivery — the bug F38 names.
 *
 * **There is no DOM environment here.** Every assertion about the page and the
 * component is a source guard: it proves a thing is referenced, never that it
 * renders. That is exactly the trap this ticket exists to close — `UsageRightsCard`
 * was correct and unmounted for a whole wave — so the guards below assert that the
 * page *mounts* what it needs, and a walkthrough in a browser is still the only
 * proof it works.
 */

const BRAND_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const DEAL_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERABLE_ID = '44444444-4444-4444-8444-444444444444';

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8')
    // JSX `{/* … */}` blocks first, then block and line comments. A component
    // that documents the rule it follows names that rule in prose, and an
    // un-stripped guard reads the explanation as the violation.
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const READ_MODULE = 'lib/deals/brand-detail.ts';
const COPY_MODULE = 'lib/deals/copy.ts';
const REVIEW_PAGE = 'app/(brand)/(onboarded)/deals/[id]/page.tsx';
const CREATOR_DEAL_PAGE = 'app/(creator)/creator/deals/[id]/page.tsx';
const NOT_FOUND_PAGE = 'app/(brand)/(onboarded)/deals/[id]/not-found.tsx';
const ACTIONS_COMPONENT = 'components/deals/review-actions.tsx';
const CAMPAIGN_PAGE = 'app/(brand)/(onboarded)/campaigns/[id]/page.tsx';
const TEMPLATES = 'lib/notifications/templates.tsx';

const joinRow = (over: Partial<BrandDealJoinRow> = {}): BrandDealJoinRow => ({
  id: DEAL_ID,
  status: 'delivered',
  campaignId: CAMPAIGN_ID,
  campaignName: 'Ramadan Beauty Push',
  creatorHandle: '@selam',
  creatorImage: null,
  videoCount: 2,
  unitPrice: 150_000,
  totalPrice: 300_000,
  rightsTermsVersion: 'v1.0',
  ...over,
});

const video = (
  over: Partial<BrandDeliverableView> = {}
): BrandDeliverableView => ({
  videoOrdinal: 1,
  submissionVersion: 1,
  historyCompleteness: 'complete',
  revisionCategory: null,
  id: DELIVERABLE_ID,
  tiktokUrl: 'https://www.tiktok.com/@selam/video/123',
  submittedAt: new Date('2026-08-15T09:00:00Z'),
  reviewStatus: 'pending',
  reviewedAt: null,
  rejectionReason: null,
  thumbnailUrl: null,
  tiktokVideoId: null,
  ...over,
});

/** Deps that would answer, so a test asserting "never ran" cannot pass by luck. */
function okDeps(
  row: BrandDealJoinRow | null,
  videos: BrandDeliverableView[] = []
): {
  deps: BrandDealDeps;
  calls: SQL[];
  videoCalls: string[];
} {
  const calls: SQL[] = [];
  const videoCalls: string[] = [];
  return {
    calls,
    videoCalls,
    deps: {
      requireBrand: async () => ({ brandProfileId: BRAND_PROFILE_ID }),
      select: async (where) => {
        calls.push(where);
        return row;
      },
      selectDeliverables: async (dealId) => {
        videoCalls.push(dealId);
        return videos;
      },
    },
  };
}

const renderSql = (where: SQL) => new PgDialect().sqlToQuery(where);

// -- The settlement and refund legs (KAN-70 PR 4) ------------------------------

describe('readBrandDeal — settlement and external refund are status-gated', () => {
  function settlementDeps(row: BrandDealJoinRow) {
    const { deps } = okDeps(row);
    const selectSettlement = vi.fn(async () => ({
      payout: 255_000,
      commission: 45_000,
    }));
    const selectRefundStatus = vi.fn(async () => 'processing' as const);
    return {
      deps: { ...deps, selectSettlement, selectRefundStatus },
      selectSettlement,
      selectRefundStatus,
    };
  }

  it.each(['completed', 'refunded'] as const)(
    'starts the %s money read without waiting for deliverables',
    async (status) => {
      const { deps, selectSettlement, selectRefundStatus } = settlementDeps(
        joinRow({ status })
      );
      let releaseVideos: (videos: BrandDeliverableView[]) => void = () => {};
      const videos = new Promise<BrandDeliverableView[]>((resolve) => {
        releaseVideos = resolve;
      });
      const selectDeliverables = vi.fn(() => videos);
      const result = readBrandDeal(DEAL_ID, { ...deps, selectDeliverables });

      try {
        await vi.waitFor(() => {
          expect(selectDeliverables).toHaveBeenCalledWith(DEAL_ID);
          expect(
            status === 'completed' ? selectSettlement : selectRefundStatus
          ).toHaveBeenCalledWith(DEAL_ID);
        });
      } finally {
        releaseVideos([video()]);
      }

      expect((await result)?.deliverables).toEqual([video()]);
      expect(
        status === 'completed' ? selectRefundStatus : selectSettlement
      ).not.toHaveBeenCalled();
    }
  );

  it('fetches the ledger split only for a completed deal', async () => {
    const { deps, selectSettlement, selectRefundStatus } = settlementDeps(
      joinRow({ status: 'completed' })
    );

    const detail = await readBrandDeal(DEAL_ID, deps);

    expect(detail?.settlement).toEqual({ payout: 255_000, commission: 45_000 });
    expect(detail?.externalRefundStatus).toBeNull();
    expect(selectSettlement).toHaveBeenCalledWith(DEAL_ID);
    expect(selectRefundStatus).not.toHaveBeenCalled();
  });

  it('fetches the refund status only for a refunded deal', async () => {
    const { deps, selectSettlement, selectRefundStatus } = settlementDeps(
      joinRow({ status: 'refunded' })
    );

    const detail = await readBrandDeal(DEAL_ID, deps);

    expect(detail?.externalRefundStatus).toBe('processing');
    expect(detail?.settlement).toBeNull();
    expect(selectRefundStatus).toHaveBeenCalledWith(DEAL_ID);
    // Quoting a split before the ledger computed one would be a second
    // source for it — the same rule the page's own docstring states.
    expect(selectSettlement).not.toHaveBeenCalled();
  });

  it('fetches neither for a deal still in flight', async () => {
    const { deps, selectSettlement, selectRefundStatus } = settlementDeps(
      joinRow({ status: 'delivered' })
    );

    const detail = await readBrandDeal(DEAL_ID, deps);

    expect(detail?.settlement).toBeNull();
    expect(detail?.externalRefundStatus).toBeNull();
    expect(selectSettlement).not.toHaveBeenCalled();
    expect(selectRefundStatus).not.toHaveBeenCalled();
  });
});

describe('externalRefundNote — the brand-facing refund sentence', () => {
  it('says "refunded" only once the gateway confirmed', () => {
    expect(externalRefundNote('refunded')).toBe(
      'Refunded to your original payment method.'
    );
  });

  it.each(['pending', 'processing', 'failed'] as const)(
    'says "on its way" for %s — failed included, because the failure is ours to retry',
    (status) => {
      expect(externalRefundNote(status)).toBe(
        'A refund to your original payment method is on its way.'
      );
    }
  );
});

// -- The read path -----------------------------------------------------------

describe('readBrandDeal — ownership is the base of the lookup', () => {
  it('returns the brand’s own deal', async () => {
    const { deps } = okDeps(joinRow());
    await expect(readBrandDeal(DEAL_ID, deps)).resolves.toMatchObject({
      id: DEAL_ID,
      creatorHandle: '@selam',
    });
  });

  it('puts the brand id in the where clause, not in a later check', () => {
    const { sql, params } = renderSql(
      buildBrandDealWhere(DEAL_ID, BRAND_PROFILE_ID)
    );

    // Both halves present, and the brand half is on `campaign`, which is the only
    // table that knows who owns a deal.
    expect(sql).toContain('"deal"."id"');
    expect(sql).toContain('"campaign"."brand_id"');
    expect(params).toContain(BRAND_PROFILE_ID);
    expect(params).toContain(DEAL_ID);
  });

  it('never runs the query when the caller has no brand profile', async () => {
    const { deps, calls } = okDeps(joinRow());
    const denied: BrandDealDeps = {
      ...deps,
      requireBrand: async () => ({ brandProfileId: null }),
    };

    await expect(readBrandDeal(DEAL_ID, denied)).resolves.toBeNull();
    // The point of the seam: not merely that nothing came back, but that nothing
    // was asked.
    expect(calls).toHaveLength(0);
  });

  it('never runs the query for a malformed id', async () => {
    const { deps, calls } = okDeps(joinRow());

    await expect(readBrandDeal('not-a-uuid', deps)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rejects malformed ids without auth reads, but gates every valid id', async () => {
    const calls: SQL[] = [];
    const requireBrand = vi.fn(async () => {
      throw new Error('forbidden');
    });
    const deps: BrandDealDeps = {
      requireBrand,
      select: async (where) => {
        calls.push(where);
        return null;
      },
      selectDeliverables: async () => [],
    };

    await expect(readBrandDeal('not-a-uuid', deps)).resolves.toBeNull();
    expect(requireBrand).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);

    await expect(readBrandDeal(DEAL_ID, deps)).rejects.toThrow('forbidden');
    expect(requireBrand).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0);
  });

  it('answers null for an unknown id and for another brand’s deal alike', async () => {
    // The query is scoped by brand, so "belongs to someone else" comes back as no
    // row — indistinguishable from "does not exist", which is the property.
    const { deps } = okDeps(null);
    await expect(readBrandDeal(DEAL_ID, deps)).resolves.toBeNull();
  });

  it('takes the brand id from the guard, never from an argument', () => {
    const source = src(READ_MODULE);

    // One parameter, and it is the deal id. A `brandProfileId` argument is the
    // shape that lets a caller read another brand's deal.
    expect(source).toMatch(
      /export async function readBrandDeal\(\s*dealId: string,\s*deps/
    );
    expect(source).toContain(
      'const { brandProfileId } = await deps.requireBrand'
    );
    expect(source).toContain("guard({ roles: ['brand'] })");
  });

  it('selects no creator contact column (NFR-010)', () => {
    const source = src(READ_MODULE);

    expect(source).toContain('creatorProfile.tiktokHandle');
    expect(source).not.toMatch(/creatorProfile\.(email|phone|contact)/);
    // The `user` table is where an address would come from. The avatar feature
    // joins it, but the only column allowed off it is `image`; anything else
    // (`user.email`, `user.name`, …) trips this pin.
    expect(source).not.toContain('from(user)');
    expect(source).not.toMatch(/user\.(?!id\b|image\b)\w+/);
  });

  it('left-joins the rows that may legitimately be missing', () => {
    const source = src(READ_MODULE);

    // A deal with no recorded terms version must come back and say so rather than
    // vanish from its owner's own review screen. The deliverable is no longer
    // joined here at all (F38) — it is its own read, asserted below.
    expect(source).toMatch(/leftJoin\(rightsTerms/);
    // Ownership rides on the campaign join, so that one cannot be left.
    expect(source).toMatch(/innerJoin\(campaign/);
  });
});

describe('readBrandDeal — the deal’s videos are a second, gated read (F38)', () => {
  it('carries every submitted video, oldest first', async () => {
    const first = video({ id: DELIVERABLE_ID });
    const second = video({
      id: '55555555-5555-4555-8555-555555555555',
      submittedAt: new Date('2026-08-16T09:00:00Z'),
    });
    const { deps } = okDeps(joinRow(), [first, second]);

    const detail = await readBrandDeal(DEAL_ID, deps);

    expect(detail?.deliverables).toEqual([first, second]);
  });

  it('is an empty list, not null, before anything is submitted', async () => {
    // A deal priced for three videos can have none, one or three. The page asks
    // `length` against `videoCount`, so an absent list would have to be defended
    // against at every use.
    const { deps } = okDeps(joinRow(), []);

    const detail = await readBrandDeal(DEAL_ID, deps);

    expect(detail?.deliverables).toEqual([]);
  });

  it('never fetches the videos for a deal the caller does not own', async () => {
    // The whole point of the second seam. A row that did not come back means the
    // brand does not own this deal, and asking for its videos anyway would leak
    // whether they exist.
    const { deps, videoCalls } = okDeps(null, [video()]);

    await expect(readBrandDeal(DEAL_ID, deps)).resolves.toBeNull();
    expect(videoCalls).toHaveLength(0);
  });

  it('never fetches the videos for a malformed id or a caller with no profile', async () => {
    const malformed = okDeps(joinRow(), [video()]);
    await expect(
      readBrandDeal('not-a-uuid', malformed.deps)
    ).resolves.toBeNull();
    expect(malformed.videoCalls).toHaveLength(0);

    const noProfile = okDeps(joinRow(), [video()]);
    await expect(
      readBrandDeal(DEAL_ID, {
        ...noProfile.deps,
        requireBrand: async () => ({ brandProfileId: null }),
      })
    ).resolves.toBeNull();
    expect(noProfile.videoCalls).toHaveLength(0);
  });

  it('scopes the video read to the deal the first query returned', async () => {
    // The id from the row, not the argument — so a lookup that resolved to a
    // different deal cannot be talked into listing another one's videos.
    const { deps, videoCalls } = okDeps(joinRow(), [video()]);

    await readBrandDeal(DEAL_ID, deps);

    expect(videoCalls).toEqual([DEAL_ID]);
  });

  it('orders the videos by submission time in SQL, not in the page', () => {
    // "Video 2" has to mean the same video on two page loads, and on the
    // creator's screen too — both read this column.
    const source = src(READ_MODULE);
    const query = source.slice(
      source.indexOf('export function brandDealDeliverablesQuery')
    );

    expect(query).toContain('eq(deliverable.dealId, dealId)');
    expect(query).toContain('asc(deliverable.videoOrdinal)');
  });

  it('no longer joins the deliverable into the one-row deal query', () => {
    // A `.limit(1)` query with a left join returned one arbitrary video and
    // multiplied the deal's own columns across the rest — the read-side half of
    // F38.
    const source = src(READ_MODULE);
    const dealQuery = source.slice(
      source.indexOf('export function brandDealQuery'),
      source.indexOf('export function brandDealDeliverablesQuery')
    );

    expect(dealQuery).not.toContain('leftJoin(deliverable');
  });

  it('carries the video ids, because rejection names one', () => {
    // The reject endpoint takes a `deliverableId` now. Without the id on the read
    // the screen could render three videos and send back none of them.
    expect(src(READ_MODULE)).toMatch(
      /interface BrandDeliverableView \{[^}]*id: string/
    );
  });

  it('keeps the deal’s own rights-terms version, not the current one', () => {
    // AC-6. A deal is governed by the text its creator accepted; a later
    // republication must not change what a signed agreement says. This read has
    // no notion of "current" at all, which is what guarantees it.
    expect(joinRow({ rightsTermsVersion: 'v1.0' }).rightsTermsVersion).toBe(
      'v1.0'
    );
    expect(src(READ_MODULE)).not.toContain('getCurrentRightsTerms');
  });
});

describe('the progress copy says how much of the delivery arrived', () => {
  it('counts submitted against what was ordered', () => {
    expect(deliveryProgress(1, 3)).toBe('1 of 3 videos submitted');
    expect(deliveryProgress(3, 3)).toBe('3 of 3 videos submitted');
  });

  it('keeps the fraction even for a one-video deal', () => {
    // The brand ordered a number and is entitled to see it accounted for.
    expect(deliveryProgress(1, 1)).toBe('1 of 1 video submitted');
  });

  it('numbers videos from one, not from zero', () => {
    // The heading is read by a person, and it is how the brand's rejection note
    // and the creator's screen refer to the same video.
    expect(videoHeading(0)).toBe('Video 1');
    expect(videoHeading(1)).toBe('Video 2');
  });

  it('names no ticket in anything either side reads', () => {
    for (const copy of [
      deliveryProgress(1, 2),
      videoHeading(0),
      DELIVERABLES_TITLE,
      AWAITING_REMAINING_VIDEOS_MESSAGE,
    ]) {
      expect(copy).not.toMatch(/KAN-\d+/);
      expect(copy).not.toMatch(/F38/);
    }
  });
});

// -- What counts as delivered (KAN-200) ---------------------------------------

describe('standingVideoCount — a refused video is not a delivered one', () => {
  it('counts rows that have not been sent back', () => {
    expect(
      standingVideoCount([
        video({ reviewStatus: 'approved' }),
        video({ reviewStatus: 'pending' }),
      ])
    ).toBe(2);
  });

  it('excludes the one the brand refused', () => {
    // The bug, exactly: `recordRejection` leaves the row in place, so a raw
    // `length` told a two-video deal it was fully delivered while both sides were
    // waiting on the replacement.
    expect(
      standingVideoCount([
        video({ reviewStatus: 'approved' }),
        video({ reviewStatus: 'rejected' }),
      ])
    ).toBe(1);
  });

  it('is zero for an empty delivery, not a crash', () => {
    expect(standingVideoCount([])).toBe(0);
  });

  it('counts pending as standing, because it is with the brand', () => {
    // A submitted video awaiting review has arrived. Only a refusal takes it back
    // off the tally — `pending` is the brand's turn, not the creator's.
    expect(standingVideoCount([video({ reviewStatus: 'pending' })])).toBe(1);
  });

  it('reads the review status rather than a review timestamp', () => {
    const source = src(READ_MODULE);
    const body = source.slice(
      source.indexOf('export function standingVideoCount')
    );

    expect(body).toContain("reviewStatus !== 'rejected'");
    // `reviewedAt` is set on approval too, so it cannot distinguish the two.
    expect(body.slice(0, body.indexOf('}'))).not.toContain('reviewedAt');
  });

  it('is what both pages pass to deliveryProgress, never the raw length', () => {
    // The guard that keeps the fix. Either page reverting to `deliverables.length`
    // would restore "2 of 2 submitted" over a form asking for another link.
    for (const page of [src(REVIEW_PAGE), src(CREATOR_DEAL_PAGE)]) {
      expect(page).toContain('standingVideoCount(deal.deliverables)');
      expect(page).toContain('deliveryProgress(standing, deal.videoCount)');
      expect(page).not.toContain('deliverables.length, deal.videoCount');
    }
  });
});

describe('reviewAbsenceMessage — why there is no Approve button', () => {
  const deal = (
    over: Partial<{
      status: DealStatus;
      videoCount: number;
      deliverables: BrandDeliverableView[];
    }> = {}
  ) => ({
    status: 'delivered' as DealStatus,
    videoCount: 2,
    deliverables: [video(), video()],
    ...over,
  });

  it('says nothing at all while the button is on screen', () => {
    // `null` is the whole point: a sentence explaining an absence, rendered beside
    // the control it claims is missing, is worse than no sentence.
    expect(reviewAbsenceMessage(deal({ status: 'delivered' }))).toBeNull();
  });

  it('stays silent before anything has been submitted', () => {
    // That state has its own sentence, rendered where the video list would be —
    // this function would be a second copy of it in a different place.
    expect(
      reviewAbsenceMessage(deal({ status: 'funded', deliverables: [] }))
    ).toBeNull();
  });

  it('names the resubmission on a deal the brand sent back', () => {
    // The ordering trap. This deal has `videoCount` rows — it is "full" — and one
    // of them is refused, so its standing count is short. Both later branches
    // match, and only the first one is true: the brand is waiting on a
    // *replacement*, not on a video it never ordered.
    const sentBack = deal({
      status: 'revision_requested',
      deliverables: [
        video({ reviewStatus: 'approved' }),
        video({ reviewStatus: 'rejected' }),
      ],
    });

    expect(sentBack.deliverables).toHaveLength(sentBack.videoCount);
    expect(standingVideoCount(sentBack.deliverables)).toBeLessThan(
      sentBack.videoCount
    );
    expect(reviewAbsenceMessage(sentBack)).toBe(AWAITING_RESUBMISSION_MESSAGE);
  });

  it('says the delivery is short while videos are still owed', () => {
    expect(
      reviewAbsenceMessage(deal({ status: 'funded', deliverables: [video()] }))
    ).toBe(AWAITING_REMAINING_VIDEOS_MESSAGE);
  });

  it('says the decision is already made once the deal is finished', () => {
    expect(
      reviewAbsenceMessage(
        deal({
          status: 'completed',
          deliverables: [
            video({ reviewStatus: 'approved' }),
            video({ reviewStatus: 'approved' }),
          ],
        })
      )
    ).toBe(ALREADY_REVIEWED_MESSAGE);
  });

  it('asks the state machine whether the button is there', () => {
    // Not a status literal. The button's presence is `canReview`'s answer, so the
    // explanation for its absence has to come from the same call or the two can
    // disagree — a sentence under a live button, or a button with no sentence.
    const source = src(READ_MODULE);
    const body = source.slice(
      source.indexOf('export function reviewAbsenceMessage')
    );

    expect(body).toContain('canReview(deal.status)');
    expect(body.slice(0, body.indexOf('\n}'))).not.toMatch(
      /status === 'delivered'/
    );
  });
});

describe('labelForReviewStatus — the review column, in words', () => {
  it('covers every value the column can hold', () => {
    const statuses: ReviewStatus[] = ['pending', 'approved', 'rejected'];

    for (const status of statuses) {
      expect(labelForReviewStatus(status)).not.toBe(status);
      expect(labelForReviewStatus(status)).toMatch(/^[A-Z]/);
    }
  });

  it('borrows the deal-level words for a refusal', () => {
    // One event at two levels: `recordRejection` moves the deal to
    // `revision_requested` and the row to `rejected`, so naming them differently
    // would read as two things happening. And "Rejected" overstates it — the funds
    // stay held and the creator resubmits (AC-024).
    expect(labelForReviewStatus('rejected')).toBe(
      labelForStatus('revision_requested')
    );
    expect(labelForReviewStatus('rejected')).not.toMatch(/reject/i);
  });

  it('falls back to the raw value rather than throwing', () => {
    // A column is a text column; a row written by something older than this map
    // should render badly, not take the page down.
    expect(labelForReviewStatus('something-new')).toBe('something-new');
  });

  it('is what both pages render, never the enum', () => {
    for (const page of [src(REVIEW_PAGE), src(CREATOR_DEAL_PAGE)]) {
      expect(page).toContain('labelForReviewStatus(video.reviewStatus)');
      expect(page).not.toMatch(/\{video\.reviewStatus\}/);
    }
  });
});

// -- The state machine decides who may review --------------------------------

describe('canReview — derived, not restated', () => {
  it('is exactly {delivered} across every status', () => {
    const statuses = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];
    const reviewable = statuses.filter(canReview);

    expect(reviewable).toEqual(['delivered']);
  });

  it('refuses a deal already sent back', () => {
    // `revision_requested` has no `completed` edge, so the screen cannot offer an
    // approval the endpoint would answer with `DEAL_NOT_DELIVERED`.
    expect(canReview('revision_requested')).toBe(false);
    expect(canReview('completed')).toBe(false);
    expect(canReview('funded')).toBe(false);
  });

  it('reads the transition table rather than comparing to a literal', () => {
    const source = src('lib/deals/state-machine.ts');
    const body = source.slice(source.indexOf('export function canReview'));

    expect(body).toContain("LEGAL_TRANSITIONS[status].includes('completed')");
    expect(body).not.toMatch(/status === 'delivered'/);
  });
});

// -- The page mounts the controls ---------------------------------------------

describe('the review page is the surface the endpoints were missing', () => {
  const page = src(REVIEW_PAGE);

  it('mounts the review controls, gated on canReview', () => {
    // The assertion this whole ticket turns on. A page that read the deal and
    // forgot to render the controls would pass every other test in this file.
    expect(page).toContain('ApproveDealButton');
    expect(page).toContain('RejectVideoForm');
    expect(page).toContain('canReview(deal.status)');
    expect(page).toMatch(/reviewable \? \(?\s*<ApproveDealButton/);
  });

  it('mounts one Approve for the deal and one reject form per video (F38)', () => {
    // The asymmetry AC-023 and AC-024 imply: one hold, one payout, one Approve —
    // but a reason has to name which of three videos to redo.
    expect(page).toMatch(/deal\.deliverables\.map\(/);
    expect(page).toContain('<RejectVideoForm');
    expect(page).toContain('deliverableId={video.id}');
    // The approve button is outside the map, so it cannot be rendered per video.
    const mapBlock = page.slice(
      page.indexOf('deal.deliverables.map('),
      page.indexOf('</section>')
    );
    expect(mapBlock).not.toContain('ApproveDealButton');
  });

  it('lists every submitted video with its own link and timestamp (AC-3)', () => {
    expect(page).toContain('DELIVERABLES_TITLE');
    expect(page).toContain('videoHeading(video.videoOrdinal - 1)');
    expect(page).toContain('SUBMITTED_AT_LABEL');
    expect(page).toContain('video.tiktokUrl');
  });

  it('says why Approve is absent, from the rule rather than a ternary here', () => {
    // The sentence is chosen by `reviewAbsenceMessage` (KAN-200), which is tested
    // on its own below — the case order is load-bearing and a page is the wrong
    // place to keep it. What the page owes is rendering the answer.
    expect(page).toContain('reviewAbsenceMessage(deal)');
    expect(page).toContain('{absence}');
    expect(page).toContain('deliveryProgress(');
  });

  it('turns every miss into the shared not-found', () => {
    expect(page).toContain('readBrandDeal');
    expect(page).toMatch(/if \(!deal\) notFound\(\)/);
  });

  it('awaits params, per the Next 16 shape', () => {
    expect(page).toContain('params: Promise<{ id: string }>');
    expect(page).toContain('await params');
  });

  it('runs on Node, because the read reaches pg', () => {
    expect(page).toContain("export const runtime = 'nodejs'");
  });

  it('renders the governing terms version (AC-6)', () => {
    expect(page).toContain('rightsTermsVersion');
    expect(page).toContain('RIGHTS_TERMS_LABEL');
    expect(page).toContain('NO_RIGHTS_TERMS_MESSAGE');
  });

  it('shows a previous rejection reason when there is one (AC-7)', () => {
    expect(page).toContain('rejectionReason');
    expect(page).toContain('REJECTION_REASON_LABEL');
  });

  it('explains an absent control in a sentence, never a tooltip', () => {
    // Hover-only copy tells a touch user nothing — the rule KAN-29 set. The three
    // "no Approve" sentences now reach the page through `reviewAbsenceMessage`;
    // the empty-list one is still rendered here, because it belongs to the list
    // and not to the button.
    expect(page).toContain('AWAITING_DELIVERABLE_MESSAGE');
    expect(page).toContain('reviewAbsenceMessage');
    expect(page).not.toMatch(/<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/);
  });

  it('does not fetch or embed the submitted URL', () => {
    // Tech Spec §6.3 — the link is stored, never followed by the platform. The
    // card renders our own blob snapshot and TikTok's player from a numeric id;
    // the submitted URL itself leaves this page only as the card's explicit
    // external link (which carries `rel` — asserted in the card's own suite).
    expect(page).toContain('TiktokVideoCard');
    expect(page).not.toContain('<iframe');
    expect(page).not.toMatch(/fetch\(/);
    // The raw URL is no longer linked by the page itself.
    expect(page).not.toContain('href={video.tiktokUrl}');
  });

  it('computes no money of its own', () => {
    // The split is the ledger's to derive at approval time from the deal's own
    // snapshotted rate (invariant 8). A figure quoted here would be a second
    // source for it.
    expect(page).not.toContain('computeSplit');
    expect(page).not.toContain('COMMISSION_RATE');
  });

  it.each([
    ALREADY_REVIEWED_MESSAGE,
    AWAITING_DELIVERABLE_MESSAGE,
    AWAITING_REMAINING_VIDEOS_MESSAGE,
    AWAITING_RESUBMISSION_MESSAGE,
    DELIVERABLES_TITLE,
    NO_RIGHTS_TERMS_MESSAGE,
    REJECTION_REASON_LABEL,
  ])('renders “%s” from its constant rather than retyping it', (copy) => {
    expect(page).not.toContain(`>${copy}<`);
    expect(copy).not.toMatch(/KAN-\d+/);
  });

  it('links back to the campaign the deal belongs to', () => {
    expect(page).toContain('campaignId');
    expect(page).toMatch(/href=\{`\/campaigns\/\$\{deal\.campaignId\}`\}/);
  });

  it('has a not-found page that names no reason', () => {
    const notFound = src(NOT_FOUND_PAGE);

    expect(notFound).toContain('EmptyState');
    // A link styled as a button, never `<Button render={<Link/>}>` — the latter
    // announces a link as a button.
    expect(notFound).toContain('buttonVariants');
    expect(notFound).not.toMatch(/<Button\s+render=/);
    // Nothing that would distinguish the three kinds of miss.
    expect(notFound).not.toMatch(
      /permission|not yours|another brand|forbidden/i
    );
  });
});

// -- The controls themselves --------------------------------------------------

describe('ReviewActions posts to the endpoints and re-reads the server', () => {
  const source = src(ACTIONS_COMPONENT);

  it('is a client component, because it holds the reason', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('posts to approve and reject with the ids encoded', () => {
    expect(source).toContain(
      '`/api/deals/${encodeURIComponent(dealId)}/approve`'
    );
    expect(source).toContain(
      '`/api/deals/${encodeURIComponent(dealId)}/reject`'
    );
  });

  it('sends current versions, never payment amounts, to approve', () => {
    // The amounts are derived under the ledger's lock, so there is nothing for a
    // client to vary except which deal — and that is in the path.
    const approve = source.slice(
      source.indexOf('export function ApproveDealButton'),
      source.indexOf('export function RejectVideoForm')
    );
    expect(approve).toMatch(/JSON.stringify\(\{\s*expectedVersions\s*\}\)/);
    expect(approve).not.toContain('JSON.stringify({payout');
  });

  it('confirms before an irreversible payment, naming the whole deal', () => {
    expect(source).toContain('ConfirmDialog');
    expect(source).toContain('description={approveConfirmMessage(videoCount)}');
    expect(source).not.toContain('window.confirm');
    // The sentence has to say what cannot be undone, not merely ask — and it
    // has to say how much is being accepted, because one click pays for every
    // video on the deal (F38).
    expect(approveConfirmMessage(1)).toMatch(/cannot be undone/i);
    expect(approveConfirmMessage(3)).toMatch(/cannot be undone/i);
    expect(approveConfirmMessage(3)).toContain('all 3 videos');
    // A one-video deal has nothing to enumerate, so it does not say "all 1".
    expect(approveConfirmMessage(1)).toContain('this video');
    expect(approveConfirmMessage(1)).not.toContain('all 1');
  });

  it('sends the deliverable id with the reason, so the note names its video', () => {
    // AC-024 with several videos on a deal: a reason that does not say which one
    // leaves the creator guessing.
    expect(source).toContain('deliverableId,');
    expect(source).toContain('rejectDeliverableSchema.safeParse({');
  });

  it('gives every reject form its own state, so three cannot collide', () => {
    // One shared field would make the note ambiguous about which video it
    // described — the same species of error as the data bug F38 fixed.
    const reject = source.slice(
      source.indexOf('export function RejectVideoForm')
    );
    expect(reject).toContain('const [reason, setReason] = useState');
    expect(reject).toContain('const [rejecting, setRejecting] = useState');
    // And its own DOM ids, keyed on the deliverable.
    expect(reject).toContain('`reason-${deliverableId}`');
  });

  it('validates the reason with the same schema the server runs', () => {
    expect(source).toContain('rejectDeliverableSchema.safeParse');
    expect(source).toContain('zodIssuesToDetails');
    // And renders the server's own field errors through the same path.
    expect(source).toContain('error.details as FieldErrorMap');
    expect(source).toContain("fieldErrorsAt(errors, 'reason')");
  });

  it('sends the trimmed value the parse produced, not the raw field', () => {
    // So what the creator reads and what the deliverable row stores agree.
    expect(source).toContain('JSON.stringify(parsed.data)');
  });

  it('guards re-entry and clears the busy flag on every path', () => {
    // F11 is the bug that comes from forgetting the success path: a flag left
    // true leaves the control dead until a full reload. Each component guards its
    // own flag now, since they no longer share one.
    const approve = source.slice(
      source.indexOf('export function ApproveDealButton'),
      source.indexOf('export function RejectVideoForm')
    );
    const reject = source.slice(
      source.indexOf('export function RejectVideoForm')
    );

    expect(approve).toContain('if (approving) return');
    expect(reject).toContain('if (rejecting) return');
    expect(approve.match(/setApproving\(false\)/g)?.length).toBeGreaterThan(2);
    expect(reject.match(/setRejecting\(false\)/g)?.length).toBeGreaterThan(2);
  });

  it('refreshes rather than patching a client copy of the status', () => {
    // Whether these controls render at all is server-rendered from `deal.status`.
    expect(source).toContain('router.refresh()');
  });

  it('keeps approve out of the form’s submit path', () => {
    // Otherwise Enter in the reason field pays the creator. Now structural as
    // well as typed: approve is a different component from the form entirely.
    // The trigger opens the ConfirmDialog; the dialog's confirm runs the approve.
    expect(source).toMatch(
      /<Button\s+type="button"\s+onClick=\{\(\) => setConfirmOpen\(true\)\}/
    );
    expect(source).toMatch(/<Button\s+type="submit"/);
    const approve = source.slice(
      source.indexOf('export function ApproveDealButton'),
      source.indexOf('export function RejectVideoForm')
    );
    expect(approve).not.toContain('<form');
  });

  it('disables each control while its own request is in flight', () => {
    expect(source).toContain('disabled={approving}');
    expect(source).toContain('disabled={rejecting}');
    // No shared `busy` any more: one video's rejection must not disable another's.
    expect(source).not.toContain('disabled={busy}');
  });

  it.each([
    APPROVE_DELIVERABLE_LABEL,
    REJECT_DELIVERABLE_LABEL,
    REJECT_REASON_HINT,
  ])('renders “%s” from its constant', (copy) => {
    expect(source).not.toContain(`>${copy}<`);
    expect(copy).not.toMatch(/KAN-\d+/);
  });

  it('takes its copy from the leaf module, not the read module', () => {
    // `brand-detail.ts` imports `@/db`; a client component importing from it
    // pulls `pg` toward the browser and fails the build outright.
    expect(source).toContain("from '@/lib/deals/copy'");
    expect(source).not.toContain('brand-detail');
  });

  it('has its copy defined in the leaf module and re-exported by the read', () => {
    expect(src(COPY_MODULE)).toContain('APPROVE_DELIVERABLE_LABEL');
    expect(src(READ_MODULE)).toContain("} from './copy'");
  });
});

// -- Reachability -------------------------------------------------------------

describe('the surface is reachable', () => {
  it('is linked from the campaign’s video list', () => {
    // KAN-49 replaced the deals list this used to assert on with the performance
    // section — the same rows plus engagement counts — so the link moved from the
    // page into `video-performance.tsx`. F38 then grouped those rows by deal, so
    // the link hangs off the group rather than off one video. The claim is
    // unchanged and is the one that matters: a brand can reach this screen from
    // their campaign.
    const page = src(CAMPAIGN_PAGE);
    const list = src('components/campaign/video-performance.tsx');

    expect(page).toContain('VideoPerformance');
    expect(page).toContain('readCampaignPerformance');
    expect(list).toMatch(/href=\{`\/deals\/\$\{deal\.dealId\}`\}/);
    // The shared status vocabulary, so the list and the deal screen cannot call
    // one state two different things.
    expect(list).toContain('labelForStatus(deal.status)');
  });

  it('is where the delivery notification now points', () => {
    const templates = src(TEMPLATES);
    const submitted = templates.slice(
      templates.indexOf("case 'deliverable_submitted'"),
      templates.indexOf("case 'deliverable_approved'")
    );

    // It pointed at `/campaigns` — a page showing neither the video nor a
    // control — so KAN-46's "the brand is notified" was satisfied by a link to
    // nothing.
    expect(submitted).toContain('appUrl(`/deals/${payload.dealId}`)');
    expect(submitted).not.toContain("appUrl('/campaigns')");
  });
});

// -- The guards can fail ------------------------------------------------------

describe('the source guards are not vacuous', () => {
  it('would catch a title tooltip on a real element', () => {
    const tooltip = /<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/;

    expect('<button disabled title="not yet">Approve</button>').toMatch(
      tooltip
    );
    // And would not flag the React prop of the same name.
    expect('<EmptyState title="Nothing to review." />').not.toMatch(tooltip);
  });

  it('would catch a status literal in place of the transition table', () => {
    expect("return status === 'delivered';").toMatch(/status === 'delivered'/);
    expect(
      "return LEGAL_TRANSITIONS[status].includes('completed');"
    ).not.toMatch(/status === 'delivered'/);
  });

  it('would catch a body added to the approve request', () => {
    expect('body: JSON.stringify({ payout })').toContain('JSON.stringify');
  });

  it('would catch retyped copy', () => {
    expect('<p>Approve and pay</p>').toContain('>Approve and pay<');
    expect('<p>{APPROVE_DELIVERABLE_LABEL}</p>').not.toContain(
      '>Approve and pay<'
    );
  });

  it('would catch a ticket number in copy', () => {
    expect('Approve and pay (KAN-68)').toMatch(/KAN-\d+/);
  });

  it('would catch a gate computed but never applied', () => {
    const applied = /disabled=\{busy\}/;

    expect('<Button disabled>Approve</Button>').not.toMatch(applied);
    expect('<Button disabled={busy}>Approve</Button>').toMatch(applied);
  });

  it('reads real files, so a renamed path fails loudly', () => {
    expect(() => src('components/deals/does-not-exist.tsx')).toThrow();
  });

  it('reads sources long enough to be the real thing', () => {
    for (const file of [
      READ_MODULE,
      REVIEW_PAGE,
      NOT_FOUND_PAGE,
      ACTIONS_COMPONENT,
    ]) {
      expect(src(file).length).toBeGreaterThan(200);
    }
  });
});
