import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../lib/authz';
import { sumEscrowedByCampaign } from '../lib/payment/escrow';
import {
  CAMPAIGN_TOTAL_LABEL,
  COMMISSION_LABEL,
  EMPTY_PERFORMANCE,
  METRICS_PENDING,
  METRIC_LABELS,
  NO_VIDEOS_DESCRIPTION,
  NO_VIDEOS_TITLE,
  PAID_OUT_LABEL,
  PERFORMANCE_TITLE,
  SETTLEMENT_NOTE,
  VIEW_POST_LABEL,
  campaignVideosQuery,
  coverageNote,
  formatMetricCount,
  readCampaignPerformance,
  toCampaignTotals,
} from '../lib/campaigns/performance';
import type {
  CampaignPerformanceDeps,
  CampaignSettlement,
  CampaignVideoRow,
} from '../lib/campaigns/performance';
import type { DealStatus } from '../db/schema';

/**
 * KAN-49 — the brand's campaign performance dashboard (US-009, AC-026, FR-006).
 *
 * Four claims carry the weight, and three of them are about honesty rather than
 * correctness.
 *
 * **The money is summed from the ledger, never recomputed.** AC-026 asks for what
 * was paid out and what commission was taken; the only truthful source is the rows
 * the payout transaction wrote. `computeSplit` must not appear anywhere on this
 * read path — a second implementation of the arithmetic that pays people would
 * disagree with the first the moment a rate changed. Asserted against the emitted
 * SQL, because "which rows are summed" is checkable without a database.
 *
 * **Totals exclude what was never measured, and a recorded zero is not absence.**
 * The `video_metric` docstring is explicit that null means "not measured" and `0`
 * is data. Summing nulls as zeros would report a campaign total that quietly
 * averages in videos nobody looked at; dropping recorded zeros would do the
 * opposite. `toCampaignTotals` is pure so both directions are testable directly.
 *
 * **Absence is per field, not per row.** `updateMetricsSchema` accepts any subset,
 * so a creator can record views and leave comments blank. A row with views and no
 * comments shows the views.
 *
 * **The read gates itself before it looks at its argument**, and throws rather than
 * returning null — a sum over an unknown campaign is `0`, indistinguishable from a
 * real campaign holding nothing, so a nullable return would invite a caller to
 * render an empty dashboard for a denial.
 *
 * One thing this file cannot assert: there is no DOM environment, so every claim
 * about the page and the component is a source guard. It proves the page *mounts*
 * the section; only a browser proves it renders.
 */

const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8')
    // JSX `{/* … */}` blocks first, then block and line comments. A component that
    // documents the rule it follows names that rule in prose, and an un-stripped
    // guard reads the explanation as the violation.
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const READ_MODULE = 'lib/campaigns/performance.ts';
const ESCROW_MODULE = 'lib/payment/escrow.ts';
const COMPONENT = 'components/campaign/video-performance.tsx';
const CAMPAIGN_PAGE = 'app/(brand)/(onboarded)/campaigns/[id]/page.tsx';

const row = (over: Partial<CampaignVideoRow> = {}): CampaignVideoRow => ({
  dealId: 'd0000000-0000-4000-8000-000000000001',
  status: 'completed' as DealStatus,
  creatorHandle: '@selam',
  videoCount: 1,
  unitPrice: 150_000,
  totalPrice: 150_000,
  tiktokUrl: 'https://www.tiktok.com/@selam/video/1',
  submittedAt: new Date('2026-08-15T09:00:00Z'),
  views: null,
  likes: null,
  shares: null,
  comments: null,
  ...over,
});

const okDeps = (
  videos: CampaignVideoRow[],
  settlement: CampaignSettlement = { paidOut: 0, commission: 0 }
): { deps: CampaignPerformanceDeps; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      requireOwnership: async (id) => {
        calls.push(`guard:${id}`);
      },
      selectVideos: async (id) => {
        calls.push(`videos:${id}`);
        return videos;
      },
      selectSettlement: async (id) => {
        calls.push(`settlement:${id}`);
        return settlement;
      },
    },
  };
};

// -- AC-026 bullet 4: the money comes from the ledger ------------------------

describe('the settlement sums read the ledger', () => {
  const moduleSource = src(ESCROW_MODULE);

  it('filters each figure to its own entry type', () => {
    expect(moduleSource).toContain("= 'release_payout'");
    expect(moduleSource).toContain("= 'commission'");
  });

  it('negates, because both entry types are written negative', () => {
    // `release_payout` is `-payout` and `commission` is `-commission` (positive is
    // into escrow, negative is out). A raw SUM would render as −12,750.00 ETB paid
    // out.
    const body = moduleSource.slice(
      moduleSource.indexOf('sumSettledByCampaign')
    );
    expect(body).toMatch(/then\s*-\$\{ledgerEntry\.amount\}/);
    expect(body.match(/then -\$\{ledgerEntry\.amount\}/g)).toHaveLength(2);
  });

  it('casts both aggregates, because SUM() returns bigint as a string', () => {
    // Without the cast the figure is a string that concatenates instead of adding
    // — the trap `sumBalance` and `earningsQuery` both document.
    const body = moduleSource.slice(
      moduleSource.indexOf('sumSettledByCampaign')
    );
    expect(body.match(/::int/g)).toHaveLength(2);
  });

  it('keys on the campaign, not by walking to a deal', () => {
    const body = moduleSource.slice(
      moduleSource.indexOf('sumSettledByCampaign')
    );
    expect(body).toContain('eq(ledgerEntry.campaignId, campaignId)');
    // `ledger_entry.deal_id` is nullable for campaign-level rows; filtering on the
    // campaign keeps them, which is right for a campaign-wide figure.
    expect(body).not.toContain('innerJoin');
  });

  it('computes no commission of its own', () => {
    // The split was applied when the rows were written. Re-deriving it here would
    // be a second implementation of the arithmetic that pays people.
    expect(moduleSource).not.toContain('computeSplit');
    expect(moduleSource).not.toMatch(/0\.15|15\.00|\*\s*0\./);
  });

  it('leaves the escrow sum unfiltered, so a settled deal stops counting', () => {
    // `sumEscrowedByCampaign` is the *signed* sum over every entry type. Filtering
    // it to `hold` would keep a refunded or paid-out deal counted forever.
    const body = moduleSource.slice(
      moduleSource.indexOf('export async function sumEscrowedByCampaign'),
      moduleSource.indexOf('export async function sumSettledByCampaign')
    );
    expect(body).toContain('sum(${ledgerEntry.amount})');
    expect(body).not.toContain('entryType');
    expect(typeof sumEscrowedByCampaign).toBe('function');
  });
});

// -- The video query ---------------------------------------------------------

describe('the video query', () => {
  const { sql, params } = campaignVideosQuery(CAMPAIGN_ID).toSQL();

  it('left-joins the two rows that may legitimately be missing', () => {
    // A funded deal with nothing submitted, and a submitted video nobody has
    // measured, both have to appear and say so. An inner join would silently
    // reduce the dashboard to "videos we happen to have numbers for".
    expect(sql).toMatch(/left join "deliverable"/i);
    expect(sql).toMatch(/left join "video_metric"/i);
    expect(sql.match(/left join/gi)).toHaveLength(2);
  });

  it('inner-joins the creator, whose row cannot miss', () => {
    expect(sql).toMatch(/inner join "creator_profile"/i);
    expect(sql.match(/inner join/gi)).toHaveLength(1);
  });

  it('selects no creator contact column (NFR-010)', () => {
    expect(sql).toContain('"tiktok_handle"');
    expect(sql).not.toMatch(/"email"|"phone"/);
  });

  it('reads one campaign, bound rather than inlined, ordered by handle', () => {
    expect(sql).toContain('"campaign_id"');
    expect(sql).not.toContain(CAMPAIGN_ID);
    expect(params).toContain(CAMPAIGN_ID);
    expect(sql).toMatch(/order by/i);
  });

  it('selects all four counts', () => {
    for (const key of ['views', 'likes', 'shares', 'comments']) {
      expect(sql).toContain(`"${key}"`);
    }
  });

  it('does not read last_updated_at or stale — those are KAN-50’s', () => {
    // KAN-48 writes both. Rendering them is AC-027's other half, and selecting
    // what this ticket does not render would invite a later edit to show it
    // without deciding how.
    expect(sql).not.toContain('last_updated_at');
    expect(sql).not.toContain('"stale"');
  });
});

// -- AC-026 bullet 3: totals exclude what was not measured -------------------

describe('toCampaignTotals', () => {
  it('is null per column when no video recorded it', () => {
    // Not zero. A campaign total of 0 views claims a measurement nobody took, and
    // the whole point of AC-027's rule is that absence is not a number.
    const totals = toCampaignTotals([row(), row()]);

    expect(totals.views).toBeNull();
    expect(totals.likes).toBeNull();
    expect(totals.shares).toBeNull();
    expect(totals.comments).toBeNull();
    expect(totals.measuredVideos).toBe(0);
    expect(totals.totalVideos).toBe(2);
  });

  it('sums only the rows that recorded a metric', () => {
    const totals = toCampaignTotals([
      row({ views: 1_000, likes: 10 }),
      row(),
      row({ views: 500, likes: 5 }),
    ]);

    expect(totals.views).toBe(1_500);
    expect(totals.likes).toBe(15);
    // Never measured on any row, so still absent rather than 0.
    expect(totals.shares).toBeNull();
    expect(totals.comments).toBeNull();
    expect(totals.measuredVideos).toBe(2);
    expect(totals.totalVideos).toBe(3);
  });

  it('treats absence per field, not per row', () => {
    // `updateMetricsSchema` accepts any subset, so this row is reachable: views
    // recorded, comments not. The views must still count.
    const totals = toCampaignTotals([row({ views: 900, comments: null })]);

    expect(totals.views).toBe(900);
    expect(totals.comments).toBeNull();
    expect(totals.measuredVideos).toBe(1);
  });

  it('counts a recorded zero as data', () => {
    // The schema docstring is explicit: null is "not measured", `0` is a real,
    // recorded zero. A video that genuinely got no comments contributes 0 and
    // counts toward coverage.
    const totals = toCampaignTotals([row({ views: 10, comments: 0 })]);

    expect(totals.comments).toBe(0);
    expect(totals.measuredVideos).toBe(1);
  });

  it('does not restart the sum when a running total is zero', () => {
    // The `?? 0` rather than `|| 0` case: a recorded 0 followed by a real number
    // must accumulate, not reset.
    const totals = toCampaignTotals([row({ views: 0 }), row({ views: 7 })]);

    expect(totals.views).toBe(7);
    expect(totals.measuredVideos).toBe(2);
  });

  it('is empty for an empty campaign', () => {
    expect(toCampaignTotals([])).toEqual(EMPTY_PERFORMANCE.totals);
  });
});

// -- The read path -----------------------------------------------------------

describe('readCampaignPerformance', () => {
  it('returns the videos, their totals and the settlement', async () => {
    const { deps } = okDeps([row({ views: 12 })], {
      paidOut: 127_500,
      commission: 22_500,
    });

    const result = await readCampaignPerformance(CAMPAIGN_ID, deps);

    expect(result.videos).toHaveLength(1);
    expect(result.totals.views).toBe(12);
    expect(result.settlement).toEqual({
      paidOut: 127_500,
      commission: 22_500,
    });
  });

  it('gates before it looks at the id, and asks for brand + campaign', async () => {
    const seen: Array<{ roles: readonly string[]; kind?: string }> = [];
    const { deps } = okDeps([]);
    await readCampaignPerformance(CAMPAIGN_ID, {
      ...deps,
      requireOwnership: async (id) => {
        seen.push({ roles: ['brand'], kind: 'campaign' });
        expect(id).toBe(CAMPAIGN_ID);
      },
    });

    expect(seen).toHaveLength(1);
    // The resource-bearing form: `guard` resolves `campaign.brand_id` itself.
    const moduleSource = src(READ_MODULE);
    expect(moduleSource).toContain("roles: ['brand']");
    expect(moduleSource).toContain(
      "resource: { kind: 'campaign', id: campaignId }"
    );
  });

  it('refuses a malformed id before any query runs', async () => {
    const { deps, calls } = okDeps([row()]);

    await expect(
      readCampaignPerformance('not-a-uuid', deps)
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Not merely that it threw — that nothing was asked. Postgres answers a
    // non-uuid against a `uuid` column with `22P02`, a 500 for a mistyped link.
    expect(calls).toHaveLength(0);
  });

  it('runs no query for a caller the guard denies', async () => {
    const { deps, calls } = okDeps([row()]);

    await expect(
      readCampaignPerformance(CAMPAIGN_ID, {
        ...deps,
        requireOwnership: async () => {
          throw new ForbiddenError('not yours');
        },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toHaveLength(0);
  });

  it('issues the two reads together, after the gate', async () => {
    const { deps, calls } = okDeps([row()]);
    await readCampaignPerformance(CAMPAIGN_ID, deps);

    expect(calls[0]).toBe(`guard:${CAMPAIGN_ID}`);
    expect(calls.slice(1).sort()).toEqual([
      `settlement:${CAMPAIGN_ID}`,
      `videos:${CAMPAIGN_ID}`,
    ]);
  });

  it('throws rather than returning null, so a denial cannot render as empty', () => {
    const moduleSource = src(READ_MODULE);
    const body = moduleSource.slice(
      moduleSource.indexOf('export async function readCampaignPerformance')
    );

    expect(body).toContain('throw new ForbiddenError');
    expect(body).not.toContain('return null');
  });

  it('reads the ledger through the shared sum, not its own query', () => {
    const moduleSource = src(READ_MODULE);
    expect(moduleSource).toContain('sumSettledByCampaign');
    expect(moduleSource).not.toContain('ledgerEntry');
    expect(moduleSource).not.toContain('computeSplit');
  });
});

// -- Formatting --------------------------------------------------------------

describe('formatMetricCount', () => {
  it('groups thousands', () => {
    expect(formatMetricCount(25_000)).toBe('25,000');
    expect(formatMetricCount(1_234_567)).toBe('1,234,567');
  });

  it('renders a recorded zero as zero', () => {
    expect(formatMetricCount(0)).toBe('0');
  });

  it('renders absence as the AC’s exact string', () => {
    expect(formatMetricCount(null)).toBe('Metrics pending');
    expect(METRICS_PENDING).toBe('Metrics pending');
  });

  it('does not abbreviate', () => {
    // `awaiting-tier-list.tsx` renders `1.0M` privately for its own table. A
    // campaign total a brand may act on should not be rounded on the way out.
    expect(formatMetricCount(1_500_000)).not.toMatch(/[KM]/);
  });
});

describe('coverageNote', () => {
  it('says which videos the totals cover', () => {
    expect(coverageNote(2, 5)).toBe(
      'Totals cover 2 of 5 videos with recorded metrics.'
    );
  });

  it('agrees in number for a single video', () => {
    expect(coverageNote(1, 1)).toBe(
      'Totals cover 1 of 1 video with recorded metrics.'
    );
  });

  it('is honest when nothing is measured', () => {
    expect(coverageNote(0, 3)).toContain('0 of 3');
  });
});

// -- The page mounts it ------------------------------------------------------

describe('the campaign page shows the performance section', () => {
  const page = src(CAMPAIGN_PAGE);

  it('mounts the component and reads the data', () => {
    // The assertion the ticket turns on. A page that read the campaign and forgot
    // to render this would pass every other test in this file — the trap F31 and
    // F34 both document.
    expect(page).toContain('VideoPerformance');
    expect(page).toContain('readCampaignPerformance');
    expect(page).toMatch(/settled \? \(\s*<VideoPerformance/);
  });

  it('skips the read entirely for a draft', () => {
    // A draft has no deals and no ledger rows, and this is the page a brand
    // reloads while shopping.
    expect(page).toContain("const settled = campaign.status !== 'draft'");
    expect(page).toContain('EMPTY_PERFORMANCE');
  });

  it('keeps the escrow read where the funding suite expects it', () => {
    expect(page).toContain('settled ? readCampaignEscrow');
  });

  it('shows paid out and commission from the ledger’s own figures', () => {
    expect(page).toContain('PAID_OUT_LABEL');
    expect(page).toContain('COMMISSION_LABEL');
    expect(page).toContain('formatEtb(performance.settlement.paidOut)');
    expect(page).toContain('formatEtb(performance.settlement.commission)');
  });

  it('hides the pair until something has been paid', () => {
    // A "0.00 ETB paid out" row on a campaign nobody has approved reads as a fact
    // rather than the absence of one — the `escrowed > 0` precedent.
    expect(page).toContain('performance.settlement.paidOut > 0');
  });

  it('computes no money of its own', () => {
    expect(page).not.toContain('computeSplit');
    expect(page).not.toContain('COMMISSION_RATE');
    expect(page).not.toContain('toFixed');
    expect(page).not.toMatch(/[*/]\s*100\b/);
  });

  it('no longer runs the list it replaced', () => {
    expect(page).not.toContain('listCampaignDeals');
  });
});

// -- The component -----------------------------------------------------------

describe('VideoPerformance', () => {
  const source = src(COMPONENT);

  it('is a server component, because nothing here is interactive', () => {
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain('useState');
    expect(source).not.toContain('onClick');
  });

  it('renders all four counts per row and in the total', () => {
    expect(source).toContain('METRIC_KEYS.map');
    expect(source.match(/METRIC_KEYS\.map/g)).toHaveLength(2);
    expect(source).toContain('formatMetricCount(video[key])');
    expect(source).toContain('formatMetricCount(totals[key])');
  });

  it('links each row to the live post without fetching it', () => {
    // The URL is stored and displayed, never followed by the platform (§6.3).
    expect(source).toContain('rel="noopener noreferrer nofollow"');
    expect(source).toContain('target="_blank"');
    expect(source).not.toContain('<iframe');
    expect(source).not.toMatch(/fetch\(/);
  });

  it('says so when nothing has been submitted', () => {
    expect(source).toContain('AWAITING_DELIVERY_LABEL');
  });

  it('states the campaign total and what it covers', () => {
    expect(source).toContain('CAMPAIGN_TOTAL_LABEL');
    expect(source).toContain('coverageNote(');
  });

  it('does no arithmetic', () => {
    // Both the totals and the money arrive summed. A `.reduce` here would be a
    // second source for a figure the ledger already answered — and there is no
    // `.reduce` anywhere in `app/` or `components/` for exactly that reason.
    expect(source).not.toContain('.reduce(');
    expect(source).not.toContain('computeSplit');
    expect(source).not.toMatch(/[*/]\s*100\b/);
  });

  it('does not scroll sideways on a phone (NFR-007)', () => {
    // The two admin tables wrap in `overflow-x-auto`, which is wrong for a
    // brand-facing screen. Cards with a responsive grid instead.
    expect(source).not.toContain('overflow-x-auto');
    expect(source).not.toContain('<table');
    expect(source).toMatch(/grid-cols-2[^"]*sm:grid-cols-4/);
  });

  it('uses the shared status vocabulary', () => {
    expect(source).toContain('labelForStatus(video.status)');
    expect(source).not.toMatch(/>\{video\.status\}</);
  });

  it('shows the tier price paid, both the rate and the total (AC-026)', () => {
    // Both, not just the total: the rate is the tier's price snapshotted onto the
    // deal, and it is what a brand compares between creators. The two coincide
    // only while deals are one video each (F38).
    expect(source).toContain('formatEtb(video.unitPrice)');
    expect(source).toContain('formatEtb(video.totalPrice)');
    expect(source).toContain('video.videoCount');
  });

  it('explains an absent control in text, never a tooltip', () => {
    expect(source).not.toMatch(/<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/);
  });

  it.each([
    PERFORMANCE_TITLE,
    CAMPAIGN_TOTAL_LABEL,
    VIEW_POST_LABEL,
    NO_VIDEOS_TITLE,
    NO_VIDEOS_DESCRIPTION,
    METRICS_PENDING,
    ...Object.values(METRIC_LABELS),
  ])('renders “%s” from its constant rather than retyping it', (copy) => {
    expect(source).not.toContain(`>${copy}<`);
    expect(copy).not.toMatch(/KAN-\d+/);
  });

  it.each([PAID_OUT_LABEL, COMMISSION_LABEL, SETTLEMENT_NOTE])(
    'keeps “%s” out of the page as a literal',
    (copy) => {
      expect(src(CAMPAIGN_PAGE)).not.toContain(`>${copy}<`);
      expect(copy).not.toMatch(/KAN-\d+/);
    }
  );

  it('takes its copy from the module that owns the query', () => {
    expect(source).toContain("from '@/lib/campaigns/performance'");
  });
});

// -- The guards can fail -----------------------------------------------------

describe('the source guards are not vacuous', () => {
  it('reads sources long enough to be the real thing', () => {
    for (const file of [READ_MODULE, ESCROW_MODULE, COMPONENT, CAMPAIGN_PAGE]) {
      expect(src(file).length).toBeGreaterThan(200);
    }
  });

  it('strips comments before matching', () => {
    // `escrow.ts` documents that it must not import `computeSplit`, so the name
    // appears in prose and nowhere else. An un-stripped guard would read that
    // sentence as the violation — which is exactly what the assertion above about
    // "computes no commission of its own" depends on being impossible.
    const raw = readFileSync(join(process.cwd(), ESCROW_MODULE), 'utf8');

    expect(raw).toContain('computeSplit');
    expect(src(ESCROW_MODULE)).not.toContain('computeSplit');
    // And the strip does not eat real code.
    expect(src(ESCROW_MODULE)).toContain('sumSettledByCampaign');
  });

  it('would catch a table that scrolls sideways', () => {
    expect('<div className="overflow-x-auto"><table>').toContain(
      'overflow-x-auto'
    );
    expect('<dl className="grid grid-cols-2 sm:grid-cols-4">').not.toContain(
      'overflow-x-auto'
    );
  });

  it('would catch a raw status in place of the shared label', () => {
    expect('<Badge>{video.status}</Badge>').toMatch(/>\{video\.status\}</);
    expect('<Badge>{labelForStatus(video.status)}</Badge>').not.toMatch(
      />\{video\.status\}</
    );
  });

  it('would catch retyped copy', () => {
    expect('<h2>Video performance</h2>').toContain('>Video performance<');
    expect('<h2>{PERFORMANCE_TITLE}</h2>').not.toContain('>Video performance<');
  });

  it('would catch arithmetic on santim', () => {
    const arithmetic = /[*/]\s*100\b/;
    expect('formatEtb(paidOut / 100)').toMatch(arithmetic);
    expect('formatEtb(performance.settlement.paidOut)').not.toMatch(arithmetic);
  });

  it('would catch a ticket number in copy', () => {
    expect('Video performance (KAN-49)').toMatch(/KAN-\d+/);
  });

  it('reads real files, so a renamed path fails loudly', () => {
    expect(() => src('components/campaign/does-not-exist.tsx')).toThrow();
  });
});
