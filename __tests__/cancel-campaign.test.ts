import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cancelCampaign } from '../lib/campaigns/cancel';
import type { CancelCampaignDeps } from '../lib/campaigns/cancel';
import { ForbiddenError } from '../lib/authz';
import {
  CANCEL_CAMPAIGN_FAILED,
  CANCEL_CAMPAIGN_LABEL,
  CANCEL_CAMPAIGN_PENDING_LABEL,
  CANCEL_CAMPAIGN_SUCCESS,
  CANCEL_NOT_CANCELLABLE_MESSAGE,
  cancelCampaignPrompt,
} from '../lib/campaigns/constants';

/**
 * KAN-99 §5 — campaign cancel (draft/confirmed only), given its first surface on
 * KAN-200.
 *
 * The transition and its refusals shipped correct and unreachable: no screen
 * called the endpoint, so a brand who created a campaign by mistake was stuck with
 * it. The guards at the bottom of this file are about *reachability* — the same
 * habit F31 and F34 exist to enforce — and, since there is no DOM environment
 * here, they prove the page references the button and never that it renders.
 */

const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BRAND_ID = '77777777-7777-4777-8777-777777777777';

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CANCEL_MODULE = 'lib/campaigns/cancel.ts';
const CANCEL_BUTTON = 'components/campaign/cancel-campaign-button.tsx';
const CAMPAIGN_PAGE = 'app/(brand)/(onboarded)/campaigns/[id]/page.tsx';

function fakeDb(row: { id: string; status: string; brandId: string } | null) {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          // The row is taken under `FOR UPDATE`, so the fake has to offer the
          // same chain — a `limit()` that resolved on its own would let the lock
          // be dropped from the source without a single test noticing.
          for: () => ({
            limit: () => Promise.resolve(row ? [row] : []),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };

  return {
    db: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transaction: async (fn: (tx: any) => Promise<unknown>) => fn(tx),
    } as unknown as CancelCampaignDeps['db'],
  };
}

function alwaysAllow() {
  return async () => ({ user: { id: 'u', role: 'brand' as const } }) as never;
}

function alwaysDeny() {
  return async () => {
    throw new ForbiddenError('no session');
  };
}

describe('cancelCampaign', () => {
  it('cancels a draft campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'draft',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: true, status: 'cancelled' });
  });

  it('cancels a confirmed campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'confirmed',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: true, status: 'cancelled' });
  });

  it('refuses to cancel a funded campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'funded',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_cancellable' });
  });

  it('refuses to cancel a completed campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'completed',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_cancellable' });
  });

  it('returns not_found when the campaign does not exist', async () => {
    const { db } = fakeDb(null);

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when the brand does not own the campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'draft',
      brandId: OTHER_BRAND_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('throws when the guard denies the role', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'draft',
      brandId: BRAND_PROFILE_ID,
    });

    await expect(
      cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
        db,
        guard: alwaysDeny(),
      })
    ).rejects.toThrow();
  });

  it('takes the campaign row under a lock before reading its status', () => {
    // The check is only worth as much as the lock under it: a concurrent
    // `POST /fund` locks the same row through `lockCampaign`, so without this the
    // status read here could go stale between the check and the update and cancel
    // a campaign whose money had just been held. Missing until KAN-200 while both
    // the docstring and the inline comment claimed it was there.
    const source = src(CANCEL_MODULE);

    expect(source).toContain(".for('update')");
    expect(source.indexOf(".for('update')")).toBeLessThan(
      source.indexOf('CANCELLABLE.has(row.status)')
    );
    // And the claim in the docstring matches the code now — no `SERIALIZABLE`,
    // which was never set on this transaction.
    expect(source).not.toContain('SERIALIZABLE');
  });
});

// -- The surface the transition never had (KAN-200) ---------------------------

describe('the brand can reach the cancel path from the campaign page', () => {
  const page = src(CAMPAIGN_PAGE);
  const button = src(CANCEL_BUTTON);

  it('mounts the button, which is the assertion this fix turns on', () => {
    // `cancelCampaign` and its route shipped on KAN-99 with no caller anywhere.
    // Everything else in this file passed for four waves while a brand had no way
    // to be rid of a campaign they created by mistake.
    expect(page).toContain('CancelCampaignButton');
    expect(page).toContain('<CancelCampaignButton');
    expect(page).toContain(
      "from '@/components/campaign/cancel-campaign-button'"
    );
  });

  it('offers it only on a draft, inside the draft-only action block', () => {
    // The endpoint accepts `confirmed` too, and the UI deliberately does not:
    // cancelling then withdraws offers creators are holding, and nothing notifies
    // them. The button sits inside the existing `status === 'draft'` block, so it
    // shares that gate rather than restating it.
    const actionBlock = page.slice(
      page.indexOf("campaign.status === 'draft' &&"),
      page.indexOf("campaign.status === 'confirmed' &&")
    );

    expect(actionBlock).toContain('<CancelCampaignButton');
    expect(actionBlock).toContain('<ConfirmCampaignButton');
  });

  it('is the last control in the row, after Send offers', () => {
    // It is the one action here that does not reverse, so it does not sit where a
    // brand aiming for "Send offers" reaches it by overshooting.
    expect(page.indexOf('<ConfirmCampaignButton')).toBeLessThan(
      page.indexOf('<CancelCampaignButton')
    );
  });

  it('is a client component posting to the existing route', () => {
    expect(button.trimStart().startsWith("'use client'")).toBe(true);
    expect(button).toMatch(
      /fetch\(\s*`\/api\/campaigns\/\$\{encodeURIComponent\(campaignId\)\}\/cancel`/
    );
    expect(button).toContain("method: 'POST'");
  });

  it('confirms first, because nothing undoes this', () => {
    // The shared ConfirmDialog — the repo has a dialog primitive now, so the
    // native `window.confirm` precedent is retired.
    expect(button).toContain('ConfirmDialog');
    expect(button).toContain(
      'description={cancelCampaignPrompt(campaignName)}'
    );
    expect(button).not.toContain('window.confirm');
    expect(cancelCampaignPrompt('Ramadan Push')).toContain('Ramadan Push');
    expect(cancelCampaignPrompt('Ramadan Push')).toMatch(/cannot be undone/i);
  });

  it('refreshes in list context and leaves a cancelled campaign detail', () => {
    expect(button).toContain("context = 'detail'");
    expect(button).toMatch(
      /toast\.success\(CANCEL_CAMPAIGN_SUCCESS\);\s*if \(context === 'list'\) \{\s*router\.refresh\(\);\s*return;\s*\}\s*router\.push\('\/campaigns'\)/
    );
  });

  it('treats a refusal as "reload and look", never as an answer about the id', () => {
    // `NOT_FOUND` is also what the route answers for another brand's campaign, so
    // reporting it as "already cancelled" would make the id an existence oracle
    // from the client side — `readCreatorDetail`'s rule, on the write path.
    expect(button).toContain("code === 'NOT_FOUND'");
    expect(button).toContain("code === 'VALIDATION_ERROR'");
    expect(button).toContain('CANCEL_NOT_CANCELLABLE_MESSAGE');
    expect(CANCEL_NOT_CANCELLABLE_MESSAGE).not.toMatch(
      /funded|does not exist|another brand|permission/i
    );
  });

  it('renders every string from its constant', () => {
    for (const copy of [
      CANCEL_CAMPAIGN_LABEL,
      CANCEL_CAMPAIGN_PENDING_LABEL,
      CANCEL_CAMPAIGN_SUCCESS,
      CANCEL_CAMPAIGN_FAILED,
      CANCEL_NOT_CANCELLABLE_MESSAGE,
      cancelCampaignPrompt('Ramadan Push'),
    ]) {
      expect(button).not.toContain(`'${copy}'`);
      expect(copy).not.toMatch(/KAN-\d+/);
    }
  });

  it('says cancel, not delete, because the row survives', () => {
    // `status = 'cancelled'` — the campaign stays readable and the audit trail
    // intact. "Delete" would promise more than the transition does.
    expect(CANCEL_CAMPAIGN_LABEL).not.toMatch(/delete|remove/i);
    expect(CANCEL_CAMPAIGN_SUCCESS).not.toMatch(/delete/i);
  });
});
