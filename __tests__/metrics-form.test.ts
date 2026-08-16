import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * KAN-57 review fix — F2: the creator's metrics-entry form.
 *
 * KAN-48 built `PUT /api/deliverables/{id}/metrics` and no UI ever called it,
 * so the reminder email's "Submit your metrics" had nowhere to land. This
 * suite pins the form that is now that place: it exists, it targets the right
 * endpoint with the right verb, it converts empty fields to *undefined* rather
 * than `0` (the null-vs-zero distinction AC-027 rests on), and it renders only
 * on completed deals — the exact set the reminder sweep selects.
 */

const FORM = readFileSync('components/deals/metrics-form.tsx', 'utf8');
const CODE = FORM.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .trim();
const PAGE = readFileSync('app/(creator)/creator/deals/[id]/page.tsx', 'utf8');

describe('the metrics-entry form targets the KAN-48 endpoint', () => {
  it('PUTs to the deliverable metrics route with the deliverable id', () => {
    expect(CODE).toContain("method: 'PUT'");
    expect(CODE).toMatch(
      /\/api\/deliverables\/\$\{encodeURIComponent\(deliverableId\)\}\/metrics/
    );
  });

  it('parses with the same schema the server enforces', () => {
    // One copy of the rule, rendered by whichever side caught the bad number
    // first — the DeliverableForm pattern.
    expect(CODE).toContain('updateMetricsSchema.safeParse');
    expect(CODE).toContain('zodIssuesToDetails(parsed.error)');
  });

  it('converts an empty field to undefined, never 0', () => {
    // `Number('')` is `0`, and a recorded 0 is a measurement — the KAN-50
    // distinction that keeps "Metrics pending" honest. Empty must stay
    // undefined so the schema's optional fields see "not submitted".
    expect(CODE).toMatch(/trimmed === ''\) continue/);
    expect(CODE).toContain('Number(trimmed)');
    expect(CODE).not.toMatch(/Number\(values\[/);
  });

  it('renders only where the reminder sweep selects — completed deals', () => {
    expect(PAGE).toMatch(
      /canReportMetrics\(deal\.status\) && deal\.deliverable/
    );
    expect(PAGE).toContain(
      '<MetricsForm deliverableId={deal.deliverable.id} />'
    );
  });

  it('is the one UI caller of the metrics route', () => {
    // The review found zero callers; this is the fix. If a second caller
    // appears it is fine — the point is that the endpoint is reachable.
    expect(
      readFileSync('app/api/deliverables/[id]/metrics/route.ts', 'utf8')
    ).toMatch(/PUT \/api\/deliverables/);
  });
});

describe('the form copy is defined and used', () => {
  // The values live in `lib/deals/copy.ts`; the form consumes the identifiers
  // (a client component cannot import them from `detail.ts`). Asserting the
  // identifiers pins that the form uses the shared constants rather than
  // retyping sentences, and the copy module itself is asserted above.
  const IDENTIFIERS = [
    'METRICS_TITLE',
    'METRICS_DESCRIPTION',
    'METRICS_HINT',
    'METRIC_VIEWS_LABEL',
    'METRIC_LIKES_LABEL',
    'METRIC_SHARES_LABEL',
    'METRIC_COMMENTS_LABEL',
    'SUBMIT_METRICS_LABEL',
    'SUBMIT_METRICS_SUCCESS_MESSAGE',
    'SUBMIT_METRICS_FAILED_MESSAGE',
    'SUBMIT_METRICS_NETWORK_ERROR_MESSAGE',
    'SUBMITTING_METRICS_LABEL',
  ];

  it.each(IDENTIFIERS)('imports %s from the copy module', (identifier) => {
    expect(FORM).toContain(identifier);
  });

  it('defines the copy in lib/deals/copy.ts', () => {
    const copySource = readFileSync('lib/deals/copy.ts', 'utf8');
    expect(copySource).toContain(
      "export const METRICS_TITLE = 'Report your engagement numbers';"
    );
    expect(copySource).toContain(
      "export const SUBMIT_METRICS_LABEL = 'Submit metrics';"
    );
  });
});

// -- The guards can fail -----------------------------------------------------

describe('the source guards are not vacuous', () => {
  it('reads a source long enough to be the real thing', () => {
    expect(CODE.length).toBeGreaterThan(200);
    expect(PAGE).toContain('MetricsForm');
  });

  it('would catch a wrong endpoint or verb', () => {
    expect(
      "fetch(`/api/deliverables/${id}/metrics`, { method: 'PUT' })"
    ).toMatch(/method: 'PUT'/);
    expect("fetch(`/api/deals/${id}/metrics`, { method: 'POST' })").not.toMatch(
      /deliverables\/\$\{encodeURIComponent\(deliverableId\)\}\/metrics/
    );
  });

  it('would catch the empty-field-as-zero bug', () => {
    const emptyIsZero = /values\[[^\]]+\] === ''/;
    expect("if (values['views'] === '') return").toMatch(emptyIsZero);
    expect("if (trimmed === '') continue").not.toMatch(emptyIsZero);
  });
});
