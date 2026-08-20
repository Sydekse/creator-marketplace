import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../lib/authz';
import {
  BRAND_INBOX_TITLE,
  BRAND_INBOX_DESCRIPTION,
  BRAND_NO_DEALS_TITLE,
  BRAND_NO_DEALS_DESCRIPTION,
  groupByCampaign,
  readBrandDealInbox,
} from '../lib/deals/brand-inbox';
import type { BrandInboxDeps, BrandInboxDeal } from '../lib/deals/brand-inbox';
import { getNavLinks } from '../lib/navigation';
import type { DealStatus } from '../db/schema';

/**
 * §15 — the brand deals inbox (KAN-104).
 *
 * Three claims:
 *
 * **The gate lives inside the module.** `readBrandDealInbox` awaits
 * `requireBrand` before touching any data.
 *
 * **Deals are grouped by campaign.** A brand thinks in campaigns, not in
 * deal states. The grouping is a partition of the same rows — one query, not
 * one per campaign (NFR-001).
 *
 * **The nav link points at the real route.** Same consistency check the
 * creator inbox carries (F17).
 */

const BRAND_PROFILE_ID = 'b0000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID_1 = 'c0000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID_2 = 'c0000000-0000-4000-8000-000000000002';
const DEAL_ID = 'd0000000-0000-4000-8000-000000000001';

const makeDeal = (over: Partial<BrandInboxDeal> = {}): BrandInboxDeal => ({
  id: DEAL_ID,
  status: 'pending' as DealStatus,
  creatorHandle: '@selam',
  campaignName: 'Summer launch',
  campaignId: CAMPAIGN_ID_1,
  videoCount: 2,
  totalPrice: 300_000,
  ...over,
});

const okDeps = (rows: BrandInboxDeal[] = []): BrandInboxDeps => ({
  requireBrand: async () => ({ brandProfileId: BRAND_PROFILE_ID }),
  selectDeals: async () => rows,
});

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// -- The gate ----------------------------------------------------------------

describe('the brand inbox gate', () => {
  it('runs before any data seam', async () => {
    const selectDeals = vi.fn(async () => []);

    await expect(
      readBrandDealInbox({
        requireBrand: async () => {
          throw new ForbiddenError('not a brand');
        },
        selectDeals,
      } as never)
    ).rejects.toThrow(ForbiddenError);

    expect(selectDeals).not.toHaveBeenCalled();
  });

  it('returns null for a brand with no profile', async () => {
    const selectDeals = vi.fn(async () => []);

    const inbox = await readBrandDealInbox({
      requireBrand: async () => ({ brandProfileId: null }),
      selectDeals,
    });

    expect(inbox).toBeNull();
    expect(selectDeals).not.toHaveBeenCalled();
  });

  it('passes the brand profile id to the query', async () => {
    const selectDeals = vi.fn(async () => []);

    await readBrandDealInbox({
      requireBrand: async () => ({ brandProfileId: BRAND_PROFILE_ID }),
      selectDeals,
    });

    expect(selectDeals).toHaveBeenCalledWith(BRAND_PROFILE_ID);
  });
});

// -- Campaign grouping -------------------------------------------------------

describe('groupByCampaign', () => {
  it('groups deals by campaign', () => {
    const rows = [
      makeDeal({ id: 'd1', campaignId: CAMPAIGN_ID_1, campaignName: 'Alpha' }),
      makeDeal({ id: 'd2', campaignId: CAMPAIGN_ID_1, campaignName: 'Alpha' }),
      makeDeal({ id: 'd3', campaignId: CAMPAIGN_ID_2, campaignName: 'Beta' }),
    ];

    const groups = groupByCampaign(rows);

    expect(groups).toHaveLength(2);
    expect(groups[0].campaignId).toBe(CAMPAIGN_ID_1);
    expect(groups[0].count).toBe(2);
    expect(groups[1].campaignId).toBe(CAMPAIGN_ID_2);
    expect(groups[1].count).toBe(1);
  });

  it('returns empty for no deals', () => {
    expect(groupByCampaign([])).toEqual([]);
  });

  it('returns one group for one campaign', () => {
    const groups = groupByCampaign([makeDeal()]);

    expect(groups).toHaveLength(1);
    expect(groups[0].deals).toHaveLength(1);
  });

  it('preserves insertion order within groups', () => {
    const rows = [
      makeDeal({ id: 'first', creatorHandle: '@aaa' }),
      makeDeal({ id: 'second', creatorHandle: '@zzz' }),
    ];

    const groups = groupByCampaign(rows);

    expect(groups[0].deals.map((d) => d.id)).toEqual(['first', 'second']);
  });
});

// -- The read ----------------------------------------------------------------

describe('readBrandDealInbox', () => {
  it('returns grouped campaigns and isEmpty=false', async () => {
    const inbox = await readBrandDealInbox(
      okDeps([makeDeal(), makeDeal({ id: 'd2', campaignId: CAMPAIGN_ID_2 })])
    );

    expect(inbox?.isEmpty).toBe(false);
    expect(inbox?.campaigns).toHaveLength(2);
  });

  it('returns isEmpty=true for no deals', async () => {
    const inbox = await readBrandDealInbox(okDeps([]));

    expect(inbox?.isEmpty).toBe(true);
    expect(inbox?.campaigns).toHaveLength(0);
  });
});

// -- The query ---------------------------------------------------------------

describe('the inbox query', () => {
  it('groups in memory, not in the database', () => {
    const source = src('lib/deals/brand-inbox.ts');
    expect(source).toContain('groupByCampaign');
    expect(source).not.toMatch(/group by/i);
  });
});

// -- Nav consistency ---------------------------------------------------------

describe('brand nav includes Deals', () => {
  it('has a Deals link pointing at /deals', () => {
    const deals = getNavLinks('brand').find((l) => l.label === 'Deals');

    expect(deals).toBeDefined();
    expect(deals?.href).toBe('/deals');
  });
});

// -- Copy --------------------------------------------------------------------

describe('brand inbox copy', () => {
  it('has a title and description', () => {
    expect(BRAND_INBOX_TITLE).toBe('Deals');
    expect(BRAND_INBOX_DESCRIPTION.length).toBeGreaterThan(10);
  });

  it('has an empty state with title and description', () => {
    expect(BRAND_NO_DEALS_TITLE).not.toBe('');
    expect(BRAND_NO_DEALS_DESCRIPTION).not.toBe('');
  });

  it('names no ticket', () => {
    expect(BRAND_INBOX_TITLE).not.toMatch(/KAN-\d+/);
    expect(BRAND_NO_DEALS_TITLE).not.toMatch(/KAN-\d+/);
  });
});
