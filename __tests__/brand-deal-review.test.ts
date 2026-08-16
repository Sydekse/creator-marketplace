import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { LEGAL_TRANSITIONS, canReview } from '../lib/deals/state-machine';
import {
  ALREADY_REVIEWED_MESSAGE,
  AWAITING_DELIVERABLE_MESSAGE,
  AWAITING_RESUBMISSION_MESSAGE,
  NO_RIGHTS_TERMS_MESSAGE,
  REJECTION_REASON_LABEL,
  buildBrandDealWhere,
  readBrandDeal,
  toBrandDealDetail,
} from '../lib/deals/brand-detail';
import type {
  BrandDealDeps,
  BrandDealDetail,
  BrandDealJoinRow,
} from '../lib/deals/brand-detail';
import {
  APPROVE_CONFIRM_MESSAGE,
  APPROVE_DELIVERABLE_LABEL,
  REJECT_DELIVERABLE_LABEL,
  REJECT_REASON_HINT,
} from '../lib/deals/copy';
import type { DealStatus } from '../db/schema';

/**
 * KAN-68 — the brand reviews a delivered video and approves or rejects it
 * (US-008, AC-023, AC-024, and KAN-35's orphaned AC-6).
 *
 * Wave 12 shipped both endpoints with nothing that could reach them: no brand
 * deal surface existed, and the delivery notification's CTA landed on
 * `/campaigns`, which showed neither the video nor a control. So every claim in
 * this file is about *reachability* as much as correctness — the loop's
 * second-to-last link having a button at all.
 *
 * Four things carry the weight.
 *
 * **The read gates itself, before it looks at its arguments.** `readBrandDeal`
 * calls `guard` first and takes the brand id from its answer, never from a
 * parameter, so a caller cannot ask for somebody else's deal. The `deps` seam is
 * what lets the suite prove the query never ran for a denied caller rather than
 * merely that it returned nothing.
 *
 * **Every kind of miss is the same miss.** A malformed id, an unknown id and a
 * real deal on another brand's campaign all answer `null` and land on the same
 * not-found page. Distinguishing them would make the URL an existence oracle for
 * deal ids (Tech Spec §6.3) — `readCreatorDetail`'s rule, applied to the other
 * side of the deal.
 *
 * **The controls are derived from the state machine, not from a status literal.**
 * `canReview` reads `LEGAL_TRANSITIONS`, so an edge removed from the table removes
 * the buttons from the screen in the same edit.
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
  videoCount: 2,
  unitPrice: 150_000,
  totalPrice: 300_000,
  rightsTermsVersion: 'v1.0',
  deliverable: null,
  ...over,
});

/** Deps that would answer, so a test asserting "never ran" cannot pass by luck. */
function okDeps(detail: BrandDealDetail | null): {
  deps: BrandDealDeps;
  calls: SQL[];
} {
  const calls: SQL[] = [];
  return {
    calls,
    deps: {
      requireBrand: async () => ({ brandProfileId: BRAND_PROFILE_ID }),
      select: async (where) => {
        calls.push(where);
        return detail;
      },
    },
  };
}

const detailFrom = (over: Partial<BrandDealJoinRow> = {}) =>
  toBrandDealDetail(joinRow(over));

const renderSql = (where: SQL) => new PgDialect().sqlToQuery(where);

// -- The read path -----------------------------------------------------------

describe('readBrandDeal — ownership is the base of the lookup', () => {
  it('returns the brand’s own deal', async () => {
    const { deps } = okDeps(detailFrom());
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
    const { deps, calls } = okDeps(detailFrom());
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
    const { deps, calls } = okDeps(detailFrom());

    await expect(readBrandDeal('not-a-uuid', deps)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('gates before it looks at the id', async () => {
    // Order matters: a shape check that ran first would tell an unauthenticated
    // caller which ids are well-formed. The gate throws, so a malformed id from a
    // denied caller must still be a denial rather than a null.
    const calls: SQL[] = [];
    const deps: BrandDealDeps = {
      requireBrand: async () => {
        throw new Error('forbidden');
      },
      select: async (where) => {
        calls.push(where);
        return null;
      },
    };

    await expect(readBrandDeal('not-a-uuid', deps)).rejects.toThrow(
      'forbidden'
    );
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
    // The `user` table is where an address would come from; this read must not
    // reach it at all.
    expect(source).not.toContain('from(user)');
    expect(source).not.toContain('innerJoin(user');
  });

  it('left-joins the rows that may legitimately be missing', () => {
    const source = src(READ_MODULE);

    // A deal with no deliverable yet, or no recorded terms version, must come
    // back and say so rather than vanish from its owner's own review screen.
    expect(source).toMatch(/leftJoin\(rightsTerms/);
    expect(source).toMatch(/leftJoin\(deliverable/);
    // Ownership rides on the campaign join, so that one cannot be left.
    expect(source).toMatch(/innerJoin\(campaign/);
  });
});

describe('toBrandDealDetail — folding the deliverable', () => {
  it('is null when nothing has been submitted', () => {
    expect(detailFrom({ deliverable: null }).deliverable).toBeNull();
  });

  it('is null when the left join produced all-nulls rather than no object', () => {
    // Drizzle answers a missed left join with an object of nulls, not with null,
    // so the URL is what decides whether a submission exists.
    const detail = detailFrom({
      deliverable: {
        tiktokUrl: null,
        submittedAt: null,
        reviewStatus: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    expect(detail.deliverable).toBeNull();
  });

  it('carries the review status and any rejection reason', () => {
    const submittedAt = new Date('2026-08-15T09:00:00Z');
    const reviewedAt = new Date('2026-08-16T09:00:00Z');
    const detail = detailFrom({
      status: 'revision_requested',
      deliverable: {
        tiktokUrl: 'https://www.tiktok.com/@selam/video/123',
        submittedAt,
        reviewStatus: 'rejected',
        reviewedAt,
        rejectionReason: 'Please show the product label.',
      },
    });

    expect(detail.deliverable).toEqual({
      tiktokUrl: 'https://www.tiktok.com/@selam/video/123',
      submittedAt,
      reviewStatus: 'rejected',
      reviewedAt,
      rejectionReason: 'Please show the product label.',
    });
  });

  it('keeps the deal’s own rights-terms version, not the current one', () => {
    // AC-6. A deal is governed by the text its creator accepted; a later
    // republication must not change what a signed agreement says. This read has
    // no notion of "current" at all, which is what guarantees it.
    expect(detailFrom({ rightsTermsVersion: 'v1.0' }).rightsTermsVersion).toBe(
      'v1.0'
    );
    expect(src(READ_MODULE)).not.toContain('getCurrentRightsTerms');
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
    expect(page).toContain('ReviewActions');
    expect(page).toContain('canReview(deal.status)');
    expect(page).toMatch(/reviewable \? \(?\s*<ReviewActions/);
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
    // Hover-only copy tells a touch user nothing — the rule KAN-29 set.
    expect(page).toContain('ALREADY_REVIEWED_MESSAGE');
    expect(page).toContain('AWAITING_RESUBMISSION_MESSAGE');
    expect(page).toContain('AWAITING_DELIVERABLE_MESSAGE');
    expect(page).not.toMatch(/<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/);
  });

  it('does not fetch or embed the submitted URL', () => {
    // Tech Spec §6.3 — the link is stored and displayed, never followed by the
    // platform, and an anchor the brand clicks carries `rel` so the destination
    // gets no handle on the opener.
    expect(page).toContain('rel="noopener noreferrer nofollow"');
    expect(page).not.toContain('<iframe');
    expect(page).not.toMatch(/fetch\(/);
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
    AWAITING_RESUBMISSION_MESSAGE,
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

  it('sends no body to approve', () => {
    // The amounts are derived under the ledger's lock, so there is nothing for a
    // client to vary except which deal — and that is in the path.
    const approve = source.slice(
      source.indexOf('async function handleApprove'),
      source.indexOf('async function handleReject')
    );
    expect(approve).toMatch(/\{ method: 'POST' \}/);
    expect(approve).not.toContain('JSON.stringify');
  });

  it('confirms before an irreversible payment', () => {
    expect(source).toContain('window.confirm(APPROVE_CONFIRM_MESSAGE)');
    // The sentence has to say what cannot be undone, not merely ask.
    expect(APPROVE_CONFIRM_MESSAGE).toMatch(/cannot be undone/i);
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
    expect(source).toContain('if (busy) return');

    // F11 is the bug that comes from forgetting the success path: a flag left
    // true leaves both buttons dead until a full reload.
    const approve = source.slice(
      source.indexOf('async function handleApprove'),
      source.indexOf('async function handleReject')
    );
    const reject = source.slice(source.indexOf('async function handleReject'));

    expect(approve.match(/setApproving\(false\)/g)?.length).toBeGreaterThan(2);
    expect(reject.match(/setRejecting\(false\)/g)?.length).toBeGreaterThan(2);
  });

  it('refreshes rather than patching a client copy of the status', () => {
    // Whether these controls render at all is server-rendered from `deal.status`.
    expect(source).toContain('router.refresh()');
  });

  it('keeps approve out of the form’s submit path', () => {
    // Otherwise Enter in the reason field pays the creator.
    expect(source).toMatch(
      /<Button\s+type="button"\s+onClick=\{handleApprove\}/
    );
    expect(source).toMatch(/<Button\s+type="submit"/);
  });

  it('disables both controls while either is in flight', () => {
    const applied = /disabled=\{busy\}/g;
    expect(source.match(applied)?.length).toBe(2);
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
  it('is linked from the campaign’s deal list', () => {
    const page = src(CAMPAIGN_PAGE);

    expect(page).toContain('listCampaignDeals');
    expect(page).toMatch(/href=\{`\/deals\/\$\{d\.id\}`\}/);
    // The shared status vocabulary, so the list and the deal screen cannot call
    // one state two different things.
    expect(page).toContain('labelForStatus(d.status)');
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
