import { existsSync, readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fundCampaign } from '../lib/campaigns/fund-campaign';
import type { FundCampaignDeps } from '../lib/campaigns/fund-campaign';
import type { PaymentFailureContext } from '../lib/payment/log';
import { logPaymentFailure, scrubProviderText } from '../lib/payment/log';
import { LedgerError } from '../lib/payment/ledger';
import { PaymentError } from '../lib/payment';
import { ErrorCode, ErrorHttpStatus, ErrorMessage } from '../lib/validation';

/**
 * KAN-44 — a funding failure leaves the campaign unfunded and untouched
 * (US-007, AC-020, NFR-003, NFR-010).
 *
 * **Where the other half of this AC is tested.** "No ledger rows survive" and
 * "deal statuses are unchanged" are properties of the transaction, so they are
 * asserted in `escrow-ledger.test.ts` against the recording fake database that
 * can actually observe a `ROLLBACK`. Restating them here against a stubbed
 * `hold` would assert that a stub does nothing.
 *
 * What is covered here is the part that was missing rather than merely untested:
 * the failure detail reaching a log, in a form that carries no card number and no
 * PII, while the brand's response carries one fixed sentence and nothing else.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleFundCampaign } =
  await import('../app/api/campaigns/[id]/fund/route');

const BRAND_USER_ID = '00000000-0000-4000-8000-00000000user';
const BRAND_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A decline reason of the shape that makes this ticket necessary: a processor
 * quoting the instrument back at us, in text we do not control.
 */
const PAN = '4111111111111111';
const LEAKY_PROVIDER_MESSAGE = `Card ${PAN} declined by issuer; contact brand@example.com`;

interface Recorded {
  logs: Array<{ error: unknown; context: PaymentFailureContext }>;
  held: number;
  notified: number;
}

function makeDeps(holdError?: unknown): {
  deps: FundCampaignDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = { logs: [], held: 0, notified: 0 };

  const deps: FundCampaignDeps = {
    getCampaign: async (id) => ({ id, name: 'Ramadan launch' }),
    hold: async () => {
      if (holdError) throw holdError;
      recorded.held++;
      return { dealCount: 2, totalHeld: 150_000, providerRef: 'mock_ref' };
    },
    notify: (async () => {
      recorded.notified++;
    }) as FundCampaignDeps['notify'],
    logFailure: (error, context) => {
      recorded.logs.push({ error, context });
    },
  };

  return { deps, recorded };
}

/** Collects the lines a logger wrote, so the JSON can be parsed and inspected. */
function captureLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: { error: (line: string) => lines.push(line) },
    parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FUND_MODULE = stripComments(
  readFileSync('lib/campaigns/fund-campaign.ts', 'utf8')
);
const FUND_ROUTE = stripComments(
  readFileSync('app/api/campaigns/[id]/fund/route.ts', 'utf8')
);
const FUND_BUTTON = stripComments(
  readFileSync('components/campaign/fund-campaign-button.tsx', 'utf8')
);
const PAYMENT_LOG = stripComments(readFileSync('lib/payment/log.ts', 'utf8'));

beforeEach(() => {
  guardMock.mockReset();
  guardMock.mockResolvedValue({
    user: {
      id: BRAND_USER_ID,
      email: 'brand@example.com',
      name: 'Brand',
      role: 'brand',
    },
    brandProfileId: BRAND_PROFILE_ID,
    creatorProfileId: null,
  });
});

describe('scrubProviderText — NFR-010 on text we did not write', () => {
  it('redacts a card number out of a decline reason', () => {
    const scrubbed = scrubProviderText(`Card ${PAN} declined`);

    expect(scrubbed).not.toContain(PAN);
    expect(scrubbed).toContain('[redacted-digits]');
    // The useful half survives: a reader still learns it was a card decline.
    expect(scrubbed).toContain('declined');
  });

  it.each([
    ['spaces', '4111 1111 1111 1111'],
    ['dashes', '4111-1111-1111-1111'],
    ['a 12-digit Maestro', '123456789012'],
    ['a 19-digit maximum', '1234567890123456789'],
  ])('redacts a PAN written with %s', (_label, candidate) => {
    const scrubbed = scrubProviderText(`declined: ${candidate}`);
    expect(scrubbed).not.toContain(candidate);
  });

  /**
   * The boundary in both directions. 11 digits is under the shortest real PAN, and
   * redacting there would eat the ids and amounts that make a log line worth
   * reading.
   */
  it('leaves an 11-digit run alone', () => {
    expect(scrubProviderText('ref 12345678901')).toContain('12345678901');
  });

  /**
   * The regression this pattern was rewritten for. An all-digit uuid — which the
   * fixtures in this repo use — is one long hyphen-separated digit run, so the
   * PAN rule ate it and the campaign id vanished from the line that exists to
   * identify the campaign.
   */
  it('leaves an all-digit uuid readable', () => {
    const scrubbed = scrubProviderText(`campaign ${CAMPAIGN_ID} failed`);

    expect(scrubbed).toContain(CAMPAIGN_ID);
    expect(scrubbed).not.toContain('[redacted-digits]');
  });

  it('leaves a mixed-hex uuid readable', () => {
    const uuid = '3f2a9c1e-7b4d-4e8a-9f01-2c6b8d4a5e7f';
    expect(scrubProviderText(`deal ${uuid} failed`)).toContain(uuid);
  });

  it('keeps several uuids in their own positions', () => {
    // The restore walks the placeholders in order. Swapping two ids would be
    // worse than redacting them: the line would name the wrong campaign.
    const other = '33333333-3333-4333-8333-333333333333';
    const scrubbed = scrubProviderText(`from ${CAMPAIGN_ID} to ${other}`);

    expect(scrubbed).toBe(`from ${CAMPAIGN_ID} to ${other}`);
  });

  it('still redacts a PAN sitting next to a uuid', () => {
    const scrubbed = scrubProviderText(`campaign ${CAMPAIGN_ID} card ${PAN}`);

    expect(scrubbed).toContain(CAMPAIGN_ID);
    expect(scrubbed).not.toContain(PAN);
  });

  /**
   * The mask/restore step uses a NUL-delimited placeholder, so a processor that
   * sent one could otherwise forge a slot and shift every id one position along
   * — a line naming the wrong campaign, which is worse than a redacted one.
   * Stripping the delimiter from the input first makes the shape unforgeable.
   */
  it('cannot be made to reorder ids by a forged placeholder', () => {
    const nul = String.fromCharCode(0);
    const forged = `${nul}uuid${nul}`;
    const other = '33333333-3333-4333-8333-333333333333';

    const scrubbed = scrubProviderText(
      `${forged} from ${CAMPAIGN_ID} to ${other}`
    );

    // Each id still sits where it was sent. A forged slot that survived would
    // shift the restore by one and name the wrong campaign — worse than
    // redacting the ids, because the line would read as true.
    expect(scrubbed.indexOf(CAMPAIGN_ID)).toBeLessThan(scrubbed.indexOf(other));
    expect(scrubbed).toContain(`from ${CAMPAIGN_ID} to ${other}`);
    expect(scrubbed).not.toContain(nul);
  });

  it('flattens control characters a processor sent', () => {
    // CWE-117 is already closed by toLogString's JSON encoding; this keeps the
    // exported string safe for a caller that writes it any other way. A space,
    // not a deletion, so the words either side stay separate.
    const scrubbed = scrubProviderText('declined\r\nlevel=info fake');

    expect(scrubbed).not.toMatch(/[\r\n]/);
    expect(scrubbed).toBe('declined  level=info fake');
  });

  it('leaves a santim amount readable', () => {
    // 150_000 santim is six digits; even a 100M ETB campaign is ten.
    expect(scrubProviderText('holding 150000')).toContain('150000');
    expect(scrubProviderText('holding 10000000000')).toContain('10000000000');
  });

  it('caps a runaway message', () => {
    const scrubbed = scrubProviderText('x'.repeat(5_000));

    expect(scrubbed.length).toBeLessThan(600);
    expect(scrubbed).toContain('…[truncated]');
  });

  it('passes ordinary text through untouched', () => {
    expect(scrubProviderText('Insufficient funds.')).toBe(
      'Insufficient funds.'
    );
  });
});

describe('logPaymentFailure — AC-020 bullet 7', () => {
  it('writes one field-parseable line', () => {
    const { logger, lines, parsed } = captureLogger();

    logPaymentFailure(
      new PaymentError('Insufficient funds.', 'INSUFFICIENT_FUNDS'),
      { operation: 'fund_campaign', campaignId: CAMPAIGN_ID },
      logger
    );

    expect(lines).toHaveLength(1);
    const [line] = parsed();
    expect(line.event).toBe('payment.failed');
    expect(line.level).toBe('error');
    expect(line.operation).toBe('fund_campaign');
    expect(line.code).toBe('INSUFFICIENT_FUNDS');
    expect(line.campaignId).toBe(CAMPAIGN_ID);
  });

  it('keeps the provider detail, which is the point of logging at all', () => {
    const { logger, parsed } = captureLogger();

    logPaymentFailure(
      new PaymentError('Issuer declined: do not honour', 'INSUFFICIENT_FUNDS'),
      { operation: 'fund_campaign' },
      logger
    );

    expect(String(parsed()[0].message)).toContain('do not honour');
  });

  it('scrubs a card number and an email out of the line', () => {
    const { logger, lines } = captureLogger();

    logPaymentFailure(
      new PaymentError(LEAKY_PROVIDER_MESSAGE, 'INSUFFICIENT_FUNDS'),
      { operation: 'fund_campaign', campaignId: CAMPAIGN_ID },
      logger
    );

    // Asserted against the raw serialized line, not the parsed object: what
    // matters is what reaches the drain, wherever in the payload it sits.
    expect(lines[0]).not.toContain(PAN);
    expect(lines[0]).not.toContain('brand@example.com');
    expect(lines[0]).toContain('***@***.***');
  });

  it('logs no amount', () => {
    const { logger, lines } = captureLogger();

    logPaymentFailure(
      new PaymentError('declined', 'INSUFFICIENT_FUNDS'),
      { operation: 'fund_campaign', campaignId: CAMPAIGN_ID },
      logger
    );

    expect(lines[0]).not.toContain('150000');
    expect(lines[0]).not.toMatch(/amount|totalHeld|total_held/);
  });

  it('marks whether the provider or our own code failed', () => {
    const { logger, parsed } = captureLogger();

    logPaymentFailure(
      new PaymentError('declined', 'PROVIDER_UNAVAILABLE'),
      { operation: 'fund_campaign' },
      logger
    );
    logPaymentFailure(
      new LedgerError('conflict', ErrorCode.PAYMENT_FAILED),
      { operation: 'fund_campaign' },
      logger
    );

    // The field that separates "the PSP is down" from "we lost a serialization
    // race three times" — the same 402 to the brand, different pages to open.
    expect(parsed()[0].isProviderError).toBe(true);
    expect(parsed()[1].isProviderError).toBe(false);
  });

  it('records the actor without recording who they are', () => {
    const { logger, lines, parsed } = captureLogger();

    logPaymentFailure(
      new PaymentError('declined', 'INSUFFICIENT_FUNDS'),
      { operation: 'fund_campaign', actorId: BRAND_USER_ID },
      logger
    );

    // An opaque uuid is the join key that makes a support report findable; an
    // email in its place would be the NFR-010 violation.
    expect(parsed()[0].actorId).toBe(BRAND_USER_ID);
    expect(lines[0]).not.toContain('brand@example.com');
  });

  it('survives a non-Error being thrown', () => {
    const { logger, parsed } = captureLogger();

    logPaymentFailure('just a string', { operation: 'fund_campaign' }, logger);

    expect(parsed()[0].event).toBe('payment.failed');
    expect(String(parsed()[0].message)).toContain('just a string');
  });

  /**
   * The one that matters most. This runs in a catch block on the way to a 402: if
   * it can throw, a diagnosable payment failure becomes an undiagnosable 500.
   */
  it('never throws, even on a hostile error object', () => {
    const { logger, lines } = captureLogger();
    const hostile = {
      name: 'Hostile',
      get message(): string {
        throw new Error('gotcha');
      },
    };

    expect(() =>
      logPaymentFailure(hostile, { operation: 'fund_campaign' }, logger)
    ).not.toThrow();
    // It degrades to a fixed line rather than writing nothing.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('payment.failed');
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('survives a circular error property', () => {
    const { logger, lines } = captureLogger();
    const circular: Record<string, unknown> = {
      name: 'Weird',
      message: 'nope',
    };
    circular.self = circular;

    expect(() =>
      logPaymentFailure(circular, { operation: 'fund_campaign' }, logger)
    ).not.toThrow();
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('defaults to console so a caller cannot forget to pass one', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logPaymentFailure(new PaymentError('declined', 'INSUFFICIENT_FUNDS'), {
      operation: 'fund_campaign',
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('fundCampaign — what a failed attempt records', () => {
  it('logs the provider failure with the campaign and the actor', async () => {
    const error = new PaymentError(
      LEAKY_PROVIDER_MESSAGE,
      'INSUFFICIENT_FUNDS'
    );
    const { deps, recorded } = makeDeps(error);

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
    expect(recorded.logs).toEqual([
      {
        error,
        context: {
          operation: 'fund_campaign',
          campaignId: CAMPAIGN_ID,
          actorId: BRAND_USER_ID,
        },
      },
    ]);
  });

  it('logs a serialization failure that outlived its retries', async () => {
    const { deps, recorded } = makeDeps(
      new LedgerError('concurrent activity', ErrorCode.PAYMENT_FAILED)
    );

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.logs).toHaveLength(1);
  });

  /**
   * The failure that would otherwise vanish: an unrecognised error re-throws into
   * a 500 with no envelope, so the log line is the only record it happened.
   */
  it('logs an unrecognised failure before re-throwing it', async () => {
    const { deps, recorded } = makeDeps(new Error('connection reset'));

    await expect(
      fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow('connection reset');

    expect(recorded.logs).toHaveLength(1);
    expect(recorded.logs[0].context.campaignId).toBe(CAMPAIGN_ID);
  });

  it.each([
    ['no accepted deals', ErrorCode.NO_ACCEPTED_DEALS],
    ['an already-funded campaign', ErrorCode.CAMPAIGN_NOT_FUNDABLE],
  ])('does not log %s as a payment failure', async (_label, code) => {
    const { deps, recorded } = makeDeps(new LedgerError('refused', code));

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    // These are the system correctly saying no, and they are visible in the
    // response. Logging them at error level would train whoever reads the drain
    // to ignore `payment.failed`.
    expect(recorded.logs).toHaveLength(0);
  });

  it('does not log an unowned campaign', async () => {
    const { deps, recorded } = makeDeps();
    deps.getCampaign = async () => null;

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.logs).toHaveLength(0);
  });

  it('tells nobody a campaign was funded when it was not', async () => {
    const { deps, recorded } = makeDeps(
      new PaymentError('declined', 'INSUFFICIENT_FUNDS')
    );

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.notified).toBe(0);
    expect(recorded.held).toBe(0);
  });
});

describe('POST /api/campaigns/[id]/fund — the failed response (AC-020)', () => {
  it('answers 402 with the exact PRD sentence', async () => {
    const { deps } = makeDeps(
      new PaymentError('declined', 'INSUFFICIENT_FUNDS')
    );

    const response = await handleFundCampaign(CAMPAIGN_ID, {
      fundCampaignDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(response.status).toBe(ErrorHttpStatus[ErrorCode.PAYMENT_FAILED]);
    expect(body.error.code).toBe(ErrorCode.PAYMENT_FAILED);
    expect(body.error.message).toBe('Payment failed — please try again.');
    // The AC's string and the enum's are the same string, not two copies.
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.PAYMENT_FAILED]);
  });

  /**
   * The other half of bullet 7: detail in the log, none in the response. A
   * processor's decline reason in an error envelope is a PAN one screenshot away
   * from a support ticket.
   */
  it('leaks no provider detail into the response body', async () => {
    const { deps } = makeDeps(
      new PaymentError(LEAKY_PROVIDER_MESSAGE, 'INSUFFICIENT_FUNDS')
    );

    const response = await handleFundCampaign(CAMPAIGN_ID, {
      fundCampaignDeps: deps,
    });
    const raw = await response.text();

    expect(raw).not.toContain(PAN);
    expect(raw).not.toContain('declined by issuer');
    expect(raw).not.toContain('brand@example.com');
    expect(raw).not.toContain('INSUFFICIENT_FUNDS');

    // The envelope carries a code and a sentence, and nothing else. Asserted as
    // an exact key set rather than field by field, so a future edit that attaches
    // provider context under some new key fails here instead of shipping.
    expect(Object.keys(JSON.parse(raw).error).sort()).toEqual([
      'code',
      'message',
    ]);
  });

  it('says the same thing whichever way the provider failed', async () => {
    const bodies: string[] = [];

    for (const code of [
      'INSUFFICIENT_FUNDS',
      'PROVIDER_UNAVAILABLE',
    ] as const) {
      const { deps } = makeDeps(new PaymentError(`failed: ${code}`, code));
      const response = await handleFundCampaign(CAMPAIGN_ID, {
        fundCampaignDeps: deps,
      });
      bodies.push(await response.text());
    }

    // Distinguishable responses would tell a caller which of our provider's
    // states it hit, one probe at a time.
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('lets the brand retry immediately, and a retry succeeds (AC-020)', async () => {
    // The provider fails once. Nothing about the failed attempt is remembered by
    // the endpoint, so the second call is an ordinary first attempt.
    const failing = makeDeps(
      new PaymentError('declined', 'INSUFFICIENT_FUNDS')
    );
    const first = await handleFundCampaign(CAMPAIGN_ID, {
      fundCampaignDeps: failing.deps,
    });
    expect(first.status).toBe(402);

    const succeeding = makeDeps();
    const second = await handleFundCampaign(CAMPAIGN_ID, {
      fundCampaignDeps: succeeding.deps,
    });
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body).toEqual({
      campaign_id: CAMPAIGN_ID,
      deals_funded: 2,
      total_held: 150_000,
    });
    expect(succeeding.recorded.notified).toBe(1);
  });

  it('holds no rate limit or lockout of its own', () => {
    // Bullet 5 says "immediately". Nothing in the route counts attempts, and this
    // is the assertion that keeps it that way — a retry limit here would be a
    // brand locked out of funding by their bank's transient decline.
    expect(FUND_ROUTE).not.toMatch(/attempt|retry|rateLimit|cooldown/i);
  });
});

describe('the fund button after a failure', () => {
  it('re-enables so the brand can retry', () => {
    // Every early return sets it back to false. A `finally` would be tidier, but
    // the success path deliberately leaves it true through `router.refresh()`.
    const returns = FUND_BUTTON.match(/setFunding\(false\)/g);
    expect(returns?.length).toBeGreaterThanOrEqual(4);
  });

  it('shows the server sentence rather than inventing one', () => {
    expect(FUND_BUTTON).toContain('body?.error?.message');
  });

  it('does not special-case PAYMENT_FAILED into its own copy', () => {
    // Paraphrasing an AC's wording client-side would create a second copy free to
    // drift from the one the API returns.
    expect(FUND_BUTTON).not.toContain('PAYMENT_FAILED');
  });
});

describe('source guards', () => {
  it('logs through the payment logger, not a bare console call', () => {
    expect(FUND_MODULE).toContain('logFailure');
    expect(FUND_MODULE).not.toContain('console.');
  });

  it('passes no amount to the logger', () => {
    const logCall = FUND_MODULE.slice(
      FUND_MODULE.indexOf('deps.logFailure('),
      FUND_MODULE.indexOf('if (!reason) throw error')
    );
    expect(logCall).not.toMatch(/total|amount|price/i);
  });

  it('scrubs before it serializes', () => {
    // Order matters: the digit scrub has to run on the message that goes into the
    // payload, not on a payload that has already been stringified.
    expect(PAYMENT_LOG).toContain('scrubProviderText(safe.message)');
  });

  it('reuses the shared extractor rather than a second email regex', () => {
    expect(PAYMENT_LOG).toContain('extractSafeErrorDetails');
    expect(PAYMENT_LOG).not.toContain('***@***.***');
  });

  /**
   * This module needs control characters in two places — the placeholder and the
   * class that strips them — and the first draft wrote them as literal bytes.
   * Everything passed: node reads them fine and prettier does not care. What
   * broke was git, which classified the file as binary on the first NUL, dropped
   * the `.gitattributes` LF normalisation, and rendered every future diff of the
   * money-path logger as `Bin 0 -> 6780 bytes`. Escapes only, in every source
   * file — a control byte nobody can see is not reviewable.
   */
  it('spells control characters as escapes, not literal bytes', () => {
    const raw = readFileSync('lib/payment/log.ts', 'utf8');
    const literals = [...raw].filter((c) => {
      const code = c.charCodeAt(0);
      return code < 32 && c !== '\n' && c !== '\t';
    });

    expect(literals).toEqual([]);
    // And the escapes are really there, so the assertion above cannot pass by
    // the characters having been dropped altogether.
    expect(PAYMENT_LOG).toContain('\\u0000');
  });

  it('has no logger of its own in the ledger', () => {
    // The ledger throws; deciding what to log is the caller's, because only the
    // caller knows whether this failure is being reported to a brand or swallowed
    // by a cron sweep.
    const ledger = stripComments(readFileSync('lib/payment/ledger.ts', 'utf8'));
    expect(ledger).not.toContain('console.');
    expect(ledger).not.toContain('logPaymentFailure');
  });

  /**
   * `poc-provider-failure.test.ts` was a KAN-40 spike artifact: it exercised a
   * local `simulatePayout` helper and an `entry_type` of `hold_pending` that never
   * shipped, so it would have stayed green with the real ledger deleted. It was
   * cited as this AC's coverage, which meant anyone looking for provider-failure
   * tests found it and stopped. Deleted on KAN-44, replaced by this file and the
   * two `holdForCampaign` cases in `escrow-ledger.test.ts`.
   */
  it('no longer carries the spike’s simulated stand-in', () => {
    expect(existsSync('__tests__/poc-provider-failure.test.ts')).toBe(false);
  });

  it('never shipped the entry type that stand-in assumed', () => {
    const schema = readFileSync('db/schema.ts', 'utf8');
    expect(schema).not.toContain('hold_pending');
  });
});
