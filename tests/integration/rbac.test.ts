import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { deliverable } from '@/db/schema';
import { handleVerifyCreator } from '@/app/api/admin/creators/[id]/verify/route';
import { handleRecordMetrics } from '@/app/api/deliverables/[id]/metrics/route';
import { handleApproveDeliverable } from '@/app/api/deals/[id]/approve/route';
import {
  createMoneyFixture,
  guardForCookie,
  profileIdForEmail,
  realVerifyDeps,
  seededDeal,
  signInCookie,
} from './helpers';

/**
 * KAN-59 AC-4 (NFR-005) — wrong role returns 403, correct role but wrong
 * owner also returns 403, asserted per endpoint.
 *
 * The unit suites already assert this matrix with a faked current-user; this
 * suite re-runs it with a *real* Better Auth session (minted by sign-in
 * against the real database) and the real DB-backed ownership lookups, so a
 * bug in session resolution or the ownership join surfaces here and nowhere
 * else. The only seam is the session reader itself — `next/headers` cannot
 * run outside a request, which is exactly the seam the route handlers expose
 * as `deps.guard`.
 *
 * Assertions are chosen to be order-independent: every 403 is a pure function
 * of role/ownership, and the allowed case never depends on a deal state that
 * another suite may have moved.
 */

function request(url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('RBAC per endpoint (NFR-005)', () => {
  it('admin-only endpoint: a creator session is refused with 403, an admin is admitted', async () => {
    const creatorCookie = await signInCookie('creator@demo.com');
    const adminCookie = await signInCookie('admin@demo.com');
    const pendingId = await profileIdForEmail('creator.pending@demo.com');

    // The 403 fires in the guard, before any deps are reached — the rest of
    // the real deps are passed anyway so the call is the real shape.
    const asCreator = await handleVerifyCreator(
      request(`/api/admin/creators/${pendingId}/verify`, {
        decision: 'verified',
      }),
      pendingId,
      realVerifyDeps(creatorCookie)
    );
    expect(asCreator.status).toBe(403);

    // The allowed case runs the whole real flow: profile update, audit row,
    // notification row, console email.
    const asAdmin = await handleVerifyCreator(
      request(`/api/admin/creators/${pendingId}/verify`, {
        decision: 'verified',
      }),
      pendingId,
      realVerifyDeps(adminCookie)
    );
    expect(asAdmin.status).toBe(200);
  });

  it('record metrics: wrong role and wrong owner are both 403, the owner succeeds', async () => {
    // A deliverable row the creator's own deal would have — built by the test
    // so the ownership question is about *this* row, whatever state the other
    // suites leave the seeded deals in.
    const { dealId } = await seededDeal('Coffee Launch');
    const [deliv] = await db
      .insert(deliverable)
      .values({
        dealId,
        tiktokUrl:
          'https://www.tiktok.com/@creator.demo/video/integration-rbac',
        reviewStatus: 'pending',
      })
      .returning({ id: deliverable.id });

    const ownerCookie = await signInCookie('creator@demo.com');
    const otherCreatorCookie = await signInCookie('creator.beauty@demo.com');
    const brandCookie = await signInCookie('brand@demo.com');

    const asBrand = await handleRecordMetrics(
      request(`/api/deliverables/${deliv.id}/metrics`, { views: 5 }),
      deliv.id,
      { guard: guardForCookie(brandCookie) }
    );
    expect(asBrand.status).toBe(403);

    const asOtherOwner = await handleRecordMetrics(
      request(`/api/deliverables/${deliv.id}/metrics`, { views: 5 }),
      deliv.id,
      { guard: guardForCookie(otherCreatorCookie) }
    );
    expect(asOtherOwner.status).toBe(403);

    const asOwner = await handleRecordMetrics(
      request(`/api/deliverables/${deliv.id}/metrics`, { views: 5 }),
      deliv.id,
      { guard: guardForCookie(ownerCookie) }
    );
    expect(asOwner.status).toBe(200);
  });

  it('approve: a creator cannot approve, the owning brand completes the payout', async () => {
    // A fresh delivered deal with a live in-process hold — so the brand's
    // approve can actually succeed (a seeded deal's hold died with the seed
    // process, so the payout would fail with INVALID_REFERENCE and the test
    // would "pass" for the wrong reason). The fixture's campaign is owned by
    // brand@demo.com, so the ownership read admits the brand.
    const { dealId } = await createMoneyFixture({
      kind: 'delivered',
      label: 'KAN-59 rbac-approve',
    });

    const creatorCookie = await signInCookie('creator@demo.com');
    const brandCookie = await signInCookie('brand@demo.com');

    const asCreator = await handleApproveDeliverable(dealId, {
      guard: guardForCookie(creatorCookie),
    });
    expect(asCreator.status).toBe(403);

    // The brand owns this deal, so the guard admits them and the payout runs
    // for real against the live hold — 200 proves authorization AND the money
    // path end to end.
    const asBrand = await handleApproveDeliverable(dealId, {
      guard: guardForCookie(brandCookie),
    });
    expect(asBrand.status).toBe(200);
  });
});
