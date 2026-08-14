import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { runSchedulerJobs, verifyCronSecret } from '../lib/scheduler/harness';
import type { Job, JobRunOutput, Logger } from '../lib/scheduler/harness';
import { toLogString } from '../lib/scheduler/harness';
import type { NextRequest } from 'next/server';
import { CRON_TIMEOUT_MS, GET, handleCronRequest } from '../app/api/cron/route';
import { ErrorCode } from '../lib/validation';

/**
 * The harness and the route log one JSON object per line (the Log Drain
 * contract), so tests parse rather than substring-match prose.
 */
interface LogLine {
  event: string;
  message: string;
  job?: string;
  name?: string;
  code?: string;
  examined?: number;
  acted?: number;
  durationMs?: number;
  runId?: string;
  success?: boolean;
  totalJobs?: number;
  successfulJobs?: number;
  failedJobs?: number;
  context?: Record<string, unknown>;
  summary?: unknown;
}

function parseLogLine(line: string): LogLine {
  return JSON.parse(line) as LogLine;
}

describe('verifyCronSecret (KAN-56 AC-002)', () => {
  const env = { CRON_SECRET: 'test-secret-12345' };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false if CRON_SECRET is missing or empty in environment', () => {
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer test-secret-12345' },
    });

    expect(verifyCronSecret(req, {})).toBe(false);
    expect(verifyCronSecret(req, { CRON_SECRET: '' })).toBe(false);
    expect(verifyCronSecret(req, { CRON_SECRET: '   ' })).toBe(false);
  });

  it('uses process.env as default and handles unconfigured env gracefully', () => {
    vi.stubEnv('CRON_SECRET', '');
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(verifyCronSecret(req)).toBe(false);
  });

  it('uses process.env as default and accepts valid token correctly', () => {
    vi.stubEnv('CRON_SECRET', 'test-secret-12345');
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(verifyCronSecret(req)).toBe(true);
  });

  it('returns false if authorization header is missing', () => {
    const req = new Request('http://localhost/api/cron');
    expect(verifyCronSecret(req, env)).toBe(false);
  });

  it('returns false if authorization header does not match secret', () => {
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(verifyCronSecret(req, env)).toBe(false);
  });

  it('returns false if authorization scheme is not Bearer', () => {
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Basic test-secret-12345' },
    });
    expect(verifyCronSecret(req, env)).toBe(false);
  });

  it('returns true when valid Bearer token is provided', () => {
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(verifyCronSecret(req, env)).toBe(true);
  });

  it('accepts the bearer scheme case-insensitively and extra spacing (RFC 6750)', () => {
    // RFC 6750's scheme is case-insensitive, so `bearer ` and `Bearer   `
    // must verify the same token just as readily as the canonical form.
    const req1 = new Request('http://localhost/api/cron', {
      headers: { authorization: 'bearer test-secret-12345' },
    });
    const req2 = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer   test-secret-12345' },
    });
    expect(verifyCronSecret(req1, env)).toBe(true);
    expect(verifyCronSecret(req2, env)).toBe(true);
  });

  it('accepts a long but valid token (no arbitrary header length limit)', () => {
    // The earlier 256-character ceiling was an invented limit: the token is
    // compared by sha256 + timingSafeEqual, so length adds no attack surface.
    const longToken = `test-secret-12345${'a'.repeat(300)}`;
    const matching = new Request('http://localhost/api/cron', {
      headers: { authorization: `Bearer ${longToken}` },
    });
    const mismatching = new Request('http://localhost/api/cron', {
      headers: { authorization: `Bearer ${longToken}b` },
    });
    expect(verifyCronSecret(matching, { CRON_SECRET: longToken })).toBe(true);
    expect(verifyCronSecret(mismatching, { CRON_SECRET: longToken })).toBe(
      false
    );
  });
});

describe('runSchedulerJobs (KAN-56 AC-003, AC-005, AC-006, AC-007, NFR-010)', () => {
  function createMockLogger(): Logger & {
    logs: string[];
    errors: Array<{ message: string; extra: unknown }>;
  } {
    const logs: string[] = [];
    const errors: Array<{ message: string; extra: unknown }> = [];

    return {
      logs,
      errors,
      log: (...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      },
      warn: (...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      },
      error: (msg: unknown, extra?: unknown) => {
        errors.push({ message: String(msg), extra });
      },
    };
  }

  it('executes all jobs in sequence and aggregates results', async () => {
    const logger = createMockLogger();
    const job1: Job = {
      name: 'offer-expiry',
      run: async () => ({ examined: 15, acted: 3 }),
    };
    const job2: Job = {
      name: 'metric-reminders',
      run: async () => ({ examined: 8, acted: 1 }),
    };

    const summary = await runSchedulerJobs([job1, job2], logger);

    expect(summary.success).toBe(true);
    expect(summary.totalJobs).toBe(2);
    expect(summary.successfulJobs).toBe(2);
    expect(summary.failedJobs).toBe(0);
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0]).toMatchObject({
      jobName: 'offer-expiry',
      success: true,
      examined: 15,
      acted: 3,
    });
    expect(summary.results[1]).toMatchObject({
      jobName: 'metric-reminders',
      success: true,
      examined: 8,
      acted: 1,
    });
  });

  it('aborts job loop early when AbortSignal is triggered', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();
    controller.abort();

    const job: Job = {
      name: 'should-not-run',
      run: vi.fn(),
    };

    const summary = await runSchedulerJobs([job], logger, controller.signal);
    expect(job.run).not.toHaveBeenCalled();
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].error).toBe('ABORTED');
    expect(summary.success).toBe(false);
    expect(summary.failedJobs).toBe(1);
    expect(summary.totalJobs).toBe(1);
    expect(summary.runId).toBeTypeOf('string');
    // The pre-dispatch warning names the job that never ran.
    expect(parseLogLine(logger.logs[0]).event).toBe('job.aborted');
    expect(parseLogLine(logger.logs[0]).job).toBe('should-not-run');
  });

  it('returns success: false if loop aborts mid-flight', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();

    const job1: Job = {
      name: 'job1',
      run: async () => {
        controller.abort();
        return { examined: 1, acted: 1 };
      },
    };
    const job2: Job = {
      name: 'job2',
      run: vi.fn(),
    };

    const summary = await runSchedulerJobs(
      [job1, job2],
      logger,
      controller.signal
    );

    // job1 finished its work while the run was aborted, so the summary must
    // not claim a success — an interrupted run cannot be partially green. The
    // loop then keeps dispatching nothing (job2 never runs) but still records
    // an ABORTED marker per remaining job so the accounting stays complete.
    expect(job2.run).not.toHaveBeenCalled();
    expect(summary.success).toBe(false);
    expect(summary.failedJobs).toBe(2);
    expect(summary.successfulJobs).toBe(0);
    expect(summary.totalJobs).toBe(2);
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0].error).toBe('ABORTED');
    expect(summary.results[1].error).toBe('ABORTED');
  });

  it('does not wait for a job that never settles after the signal fires', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();

    const hangingJob: Job = {
      name: 'hanging-job',
      run: () => new Promise<JobRunOutput>(() => {}),
    };

    const pending = runSchedulerJobs([hangingJob], logger, controller.signal);
    controller.abort();

    const summary = await pending;

    expect(summary.success).toBe(false);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].jobName).toBe('hanging-job');
    expect(summary.results[0].error).toBe('ABORTED');
  });

  it('records a job that settles after the abort as ABORTED, not success', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();

    let settle: (() => void) | undefined;
    const job: Job = {
      name: 'late-settler',
      run: () =>
        new Promise((resolve) => {
          settle = () => resolve({ examined: 1, acted: 1 });
        }),
    };

    const pending = runSchedulerJobs([job], logger, controller.signal);
    controller.abort();
    settle?.();

    const summary = await pending;

    expect(summary.success).toBe(false);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].error).toBe('ABORTED');
    expect(summary.results[0].success).toBe(false);
  });

  it('never records a success for a job that settles while the abort is in flight', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();

    // The abort is queued mid-settle: the job's own microtask fires the
    // signal just before the harness's result handler runs. Whichever branch
    // of the harness absorbs the outcome (watchdog or the post-race relabel),
    // the observable contract is the same — a run that was aborted cannot
    // claim successes — and that is what this test pins.
    const job: Job = {
      name: 'settles-mid-abort',
      run: async () => {
        await null;
        queueMicrotask(() => controller.abort());
        return { examined: 1, acted: 1 };
      },
    };

    const summary = await runSchedulerJobs([job], logger, controller.signal);

    expect(summary.success).toBe(false);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].jobName).toBe('settles-mid-abort');
    expect(summary.results[0].success).toBe(false);
    expect(summary.results[0].error).toBe('ABORTED');
  });

  it('marks a job that fails while aborted as ABORTED, not a generic failure', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();

    const job: Job = {
      name: 'in-flight-abort',
      run: async () => {
        controller.abort();
        throw new Error('killed mid-run');
      },
    };

    const summary = await runSchedulerJobs([job], logger, controller.signal);

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].success).toBe(false);
    expect(summary.results[0].error).toBe('ABORTED');
  });

  it('passes AbortSignal to job.run so jobs can cancel long-running operations', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();

    let receivedSignal: AbortSignal | undefined;
    const job: Job = {
      name: 'signal-receiver',
      run: async (signal) => {
        receivedSignal = signal;
        return { examined: 1, acted: 1 };
      },
    };

    await runSchedulerJobs([job], logger, controller.signal);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBe(controller.signal);
  });

  it('wraps jobs independently so a failing job does not stop others (AC-003)', async () => {
    const logger = createMockLogger();
    const failingJob: Job = {
      name: 'failing-job',
      run: async () => {
        const err = new Error('Database connection timeout on deal d-123');
        Object.assign(err, { code: 'DB_TIMEOUT', name: 'TimeoutError' });
        throw err;
      },
    };
    const successfulJob: Job = {
      name: 'successful-job',
      run: async () => ({ examined: 5, acted: 2 }),
    };

    const summary = await runSchedulerJobs([failingJob, successfulJob], logger);

    expect(summary.success).toBe(false);
    expect(summary.totalJobs).toBe(2);
    expect(summary.successfulJobs).toBe(1);
    expect(summary.failedJobs).toBe(1);

    expect(summary.results[0]).toMatchObject({
      jobName: 'failing-job',
      success: false,
      error: 'JOB_EXECUTION_FAILED',
    });

    expect(summary.results[1]).toMatchObject({
      jobName: 'successful-job',
      success: true,
      examined: 5,
      acted: 2,
    });
  });

  it('logs run statistics containing no PII (NFR-010)', async () => {
    const logger = createMockLogger();
    const job: Job = {
      name: 'test-job',
      run: async () => ({ examined: 10, acted: 2 }),
    };

    await runSchedulerJobs([job], logger);

    const events = logger.logs.map(parseLogLine);
    const completed = events.find((l) => l.event === 'job.completed');
    expect(completed).toBeDefined();
    expect(completed?.message).toContain(
      '[Scheduler] Job "test-job" completed: examined 10 rows, acted on 2 rows'
    );
    expect(completed?.examined).toBe(10);
    expect(completed?.acted).toBe(2);

    const runCompleted = events.find((l) => l.event === 'run.completed');
    expect(runCompleted).toBeDefined();
    expect(runCompleted?.message).toMatch(/[0-9]+\/[0-9]+ jobs succeeded/);
    expect(runCompleted?.success).toBe(true);
    expect(runCompleted?.totalJobs).toBe(1);
    expect(runCompleted?.successfulJobs).toBe(1);
    expect(runCompleted?.failedJobs).toBe(0);
    expect(runCompleted?.durationMs).toBeTypeOf('number');
    expect(runCompleted?.runId).toBeTypeOf('string');

    // The only thing that must never reach a log is a bare email address.
    const logText = logger.logs.join('\n');
    expect(logText).not.toMatch(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    );
  });

  it('serializes job counters without hitting BigInt or circular-reference JSON failures', async () => {
    const logger = createMockLogger();
    const job: Job = {
      name: 'big-job',
      run: async () => ({
        // `BigInt(10)` rather than the `10n` literal: the tsconfig target
        // predates ES2020, and the call form compiles everywhere.
        examined: BigInt(10) as unknown as number,
        acted: 0,
      }),
    };

    await runSchedulerJobs([job], logger);

    const events = logger.logs.map(parseLogLine);
    const completed = events.find((l) => l.event === 'job.completed');
    expect(completed).toBeDefined();
    // BigInt is coerced to its decimal string form by the safe replacer; a
    // JSON.stringify TypeError would have made the line unparseable.
    expect(completed?.examined).toBe('10');
  });

  it('degrades circular job results to a marker string instead of throwing', async () => {
    // The serializer is the seam that must survive hostile error data (M3):
    // a circular reference in a log payload would otherwise turn the failure
    // log itself into the throw, defeating the catch that raised it.
    const result: Record<string, unknown> = { examined: 4, acted: 1 };
    result.self = result;

    const line = JSON.parse(toLogString({ summary: result })) as {
      summary: { examined: number; acted: number; self: string };
    };

    expect(line.summary.examined).toBe(4);
    expect(line.summary.self).toBe('[Circular]');
  });

  it('surfaces job failure errors in logs with context safely (AC-007)', async () => {
    const logger = createMockLogger();
    const err = new Error('Sensitive data leak user@example.com');
    Object.assign(err, {
      code: 'LEAK_CODE',
      name: 'LeakError',
      dealId: 'd-123',
    });

    const job: Job = {
      name: 'failing-expiry',
      run: async () => {
        throw err;
      },
    };

    await runSchedulerJobs([job], logger);

    expect(logger.errors).toHaveLength(1);
    const entry = parseLogLine(logger.errors[0].message);
    expect(entry.event).toBe('job.failed');
    expect(entry.message).toContain('[Scheduler] Job "failing-expiry" failed');
    expect(entry.message).toContain('[LeakError] LEAK_CODE');
    expect(entry.message).not.toContain('user@example.com');
    expect(entry.message).toContain('***@***.***');
    // The dealId survives into the log as its own structured field, so it can
    // be searched and filtered without a regex over prose (AC-007 context).
    expect(entry.context).toEqual({ dealId: 'd-123' });
  });

  it('scrubs emails with international characters and single-letter TLDs (AC-007)', async () => {
    const logger = createMockLogger();
    const err = new Error('reach the team at user@bücher.de or ops@a.b');

    const job: Job = {
      name: 'i18n-leak',
      run: async () => {
        throw err;
      },
    };

    await runSchedulerJobs([job], logger);

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0].message).toContain('***@***.***');
    expect(logger.errors[0].message).not.toContain('user@bücher.de');
    expect(logger.errors[0].message).not.toContain('ops@a.b');
  });

  it('handles non-Error payload rejections gracefully', async () => {
    const logger = createMockLogger();
    const job: Job = {
      name: 'failing-string',
      run: async () => {
        throw 'String rejection';
      },
    };

    await runSchedulerJobs([job], logger);
    expect(logger.errors).toHaveLength(1);
    const entry = parseLogLine(logger.errors[0].message);
    expect(entry.event).toBe('job.failed');
    expect(entry.message).toContain('[Error] UNKNOWN_ERROR');
    expect(entry.message).toContain('String rejection');
  });

  it('classifies null and undefined rejections as generic job failures', async () => {
    for (const payload of [null, undefined] as const) {
      const logger = createMockLogger();
      const job: Job = {
        name: 'payload-job',
        run: async () => {
          throw payload;
        },
      };

      const summary = await runSchedulerJobs([job], logger);

      expect(summary.results[0].success).toBe(false);
      expect(summary.results[0].error).toBe('JOB_EXECUTION_FAILED');
      expect(logger.errors).toHaveLength(1);
      const entry = parseLogLine(logger.errors[0].message);
      expect(entry.event).toBe('job.failed');
      expect(entry.message).toContain('[Error] UNKNOWN_ERROR');
    }
  });

  it('handles an empty job list as an immediate success', async () => {
    const logger = createMockLogger();

    const summary = await runSchedulerJobs([], logger);

    expect(summary.success).toBe(true);
    expect(summary.totalJobs).toBe(0);
    expect(summary.successfulJobs).toBe(0);
    expect(summary.failedJobs).toBe(0);
    expect(summary.results).toEqual([]);
    expect(summary.runId).toBeTypeOf('string');

    const events = logger.logs.map(parseLogLine);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('run.completed');
    expect(events[0].success).toBe(true);
  });
});

describe('Route Handler /api/cron (KAN-56 AC-001, AC-002)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'route-test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('registers the cron route on a fixed schedule in vercel.json (AC-001)', () => {
    const vercelJson = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const cron = vercelJson.crons.find(
      (entry: { path: string }) => entry.path === '/api/cron'
    );

    expect(cron).toBeDefined();
    expect(cron.schedule).toBe('0 0 * * *');
  });

  it('keeps the internal timeout below the platform maxDuration ceiling', () => {
    // The 290s budget only buys anything if the platform ceiling it sits
    // under is at least 300s. Pinned structurally so a one-line config change
    // (or a stale Vercel duration table) cannot silently invert the margin.
    const routeSource = readFileSync('app/api/cron/route.ts', 'utf8');
    expect(routeSource).toContain('export const maxDuration = 300');
    expect(CRON_TIMEOUT_MS).toBeLessThan(300000);
  });

  it('rejects every run when CRON_SECRET is unconfigured, with no config oracle (401, not 500)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });

    const res = await GET(req as unknown as NextRequest);

    // A 500 would let an unauthenticated probe distinguish "secret not set"
    // from "wrong secret" — an existence oracle for the config. The failure
    // is loud in the logs instead, and the probe gets the AC-002 401.
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(body.error.details).toEqual({});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logArg] = errorSpy.mock.calls[0];
    const entry = parseLogLine(String(logArg));
    expect(entry.event).toBe('cron.secret_unconfigured');
    expect(entry.message).toContain('CRON_SECRET is not configured');
    errorSpy.mockRestore();
  });

  it('rejects GET requests without auth header with 401 Unauthorized and WWW-Authenticate header', async () => {
    const req = new Request('http://localhost/api/cron', { method: 'GET' });
    const res = await GET(req as unknown as NextRequest);

    expect(res.status).toBe(401);
    // The realm advertises where the token applies (RFC 6750); a 401 without
    // it would still be correct, but the header guides the retry.
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="cron"');
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid or missing cron secret authorization header.',
        details: {},
      },
    });
  });

  it('returns 200 OK for a valid authenticated GET with no jobs registered', async () => {
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });
    const res = await GET(req as unknown as NextRequest);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('maps a run with failed jobs to 500 CRON_PARTIAL_FAILURE, summary kept out of the envelope', async () => {
    const runJobs = vi.fn<typeof runSchedulerJobs>(async () => ({
      success: false,
      runId: 'mock-run-1',
      timestamp: new Date().toISOString(),
      totalJobs: 2,
      successfulJobs: 1,
      failedJobs: 1,
      results: [
        {
          jobName: 'ok-job',
          success: true,
          examined: 1,
          acted: 1,
          durationMs: 5,
        },
        {
          jobName: 'bad-job',
          success: false,
          examined: 0,
          acted: 0,
          durationMs: 5,
          error: 'JOB_EXECUTION_FAILED',
        },
      ],
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });

    const res = await handleCronRequest(req, { runJobs });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.CRON_PARTIAL_FAILURE);
    // The summary is a scheduler structure, not a Record<string, string[]>;
    // the envelope stays type-clean and the summary lives in the logs.
    expect(body.error.details).toEqual({});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logArg] = errorSpy.mock.calls[0];
    const entry = parseLogLine(String(logArg));
    expect(entry.event).toBe('cron.partial_failure');
    expect(entry.message).toContain('Run completed with failed jobs');
    expect(entry.runId).toBe('mock-run-1');
    expect(JSON.stringify(entry.summary)).toContain('bad-job');
    errorSpy.mockRestore();
  });

  it('maps an unexpected runJobs rejection to 500 INTERNAL_SERVER_ERROR', async () => {
    const runJobs = vi.fn<typeof runSchedulerJobs>(async () => {
      throw new Error('Connection pool exhausted');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });

    const res = await handleCronRequest(req, { runJobs });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    expect(body.error.details).toEqual({});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logArg] = errorSpy.mock.calls[0];
    const entry = parseLogLine(String(logArg));
    expect(entry.event).toBe('cron.internal_error');
    expect(entry.message).toContain('Connection pool exhausted');
    // The log carries the extracted error code, not the mapped HTTP status —
    // the status is the envelope's business (INTERNAL_SERVER_ERROR above).
    expect(entry.code).toBe('UNKNOWN_ERROR');
    errorSpy.mockRestore();
  });

  it('propagates the request signal down into runSchedulerJobs', async () => {
    // The mock must return a real summary: runSchedulerJobs never resolves
    // undefined, so a body-less mock would make the route throw and this test
    // would pass through the catch→504 branch instead of the post-run abort
    // path it is meant to pin.
    const runJobs = vi.fn<typeof runSchedulerJobs>(async () => ({
      success: false,
      runId: 'mock-run-1',
      timestamp: new Date().toISOString(),
      totalJobs: 1,
      successfulJobs: 0,
      failedJobs: 1,
      results: [
        {
          jobName: 'in-flight-job',
          success: false,
          examined: 0,
          acted: 0,
          durationMs: 0,
          error: 'ABORTED',
        },
      ],
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reqAbort = new AbortController();
    reqAbort.abort();
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
      signal: reqAbort.signal,
    });

    const res = await handleCronRequest(req, { runJobs });

    expect(runJobs).toHaveBeenCalledTimes(1);
    const signalArg = runJobs.mock.calls[0][2];
    expect(signalArg).toBeInstanceOf(AbortSignal);
    expect(signalArg?.aborted).toBe(true);

    // The abort path, not the catch: the log is the post-run timeout summary,
    // not an "unexpected rejection".
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.CRON_TIMEOUT);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logArg] = errorSpy.mock.calls[0];
    const entry = parseLogLine(String(logArg));
    expect(entry.event).toBe('cron.timeout');
    // The post-run message, not the catch's "unexpected rejection" wording —
    // this is what distinguishes the intended path from the catch path.
    expect(entry.message).toBe('[Cron Route] Run aborted after timeout');
    expect(entry.runId).toBe('mock-run-1');
    errorSpy.mockRestore();
  });

  it('maps an unexpected runJobs rejection while aborted to 504, never 500', async () => {
    const runJobs = vi.fn<typeof runSchedulerJobs>(async () => {
      throw new Error('Connection pool exhausted');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reqAbort = new AbortController();
    reqAbort.abort();
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
      signal: reqAbort.signal,
    });

    const res = await handleCronRequest(req, { runJobs });

    // The rejection escaped while the run was already aborted, so it is a
    // timeout, not an internal failure — a 500 would blame the code for what
    // the timeout did.
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.CRON_TIMEOUT);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logArg] = errorSpy.mock.calls[0];
    const entry = parseLogLine(String(logArg));
    expect(entry.event).toBe('cron.timeout');
    expect(entry.message).toContain('Connection pool exhausted');
    errorSpy.mockRestore();
  });

  it('returns 504 CRON_TIMEOUT when the internal 290s ceiling fires mid-run', async () => {
    // The route's own budget sits 10s under the platform's 300s maxDuration
    // ceiling, so the abort below comes from the route's timer — the request
    // signal never fires in this test — and the platform is never the one
    // answering 504.
    const timeoutMs = 291000;
    vi.useFakeTimers();

    const runJobs = vi.fn<typeof runSchedulerJobs>(
      async (_jobs, _logger, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener('abort', () =>
            resolve({
              success: false,
              runId: 'mock-run-1',
              timestamp: new Date().toISOString(),
              totalJobs: 1,
              successfulJobs: 0,
              failedJobs: 1,
              results: [
                {
                  jobName: 'stalled-job',
                  success: false,
                  examined: 0,
                  acted: 0,
                  durationMs: timeoutMs,
                  error: 'ABORTED',
                },
              ],
            })
          );
        })
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });

    const pending = handleCronRequest(req, { runJobs });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    const res = await pending;

    expect(runJobs).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.CRON_TIMEOUT);
    expect(body.error.details).toEqual({});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logArg] = errorSpy.mock.calls[0];
    const entry = parseLogLine(String(logArg));
    expect(entry.event).toBe('cron.timeout');
    expect(entry.message).toContain('Run aborted after timeout');
    expect(entry.runId).toBe('mock-run-1');
    errorSpy.mockRestore();
  });

  it('lets a run that finishes under the ceiling complete normally (200, not 504)', async () => {
    // Sub-ceiling boundary (M4): a run that settles before CRON_TIMEOUT_MS
    // must answer 200. Advancing the clock to exactly one millisecond under
    // the ceiling fires the run's own settle-timer but not the route's abort
    // timer — a premature abort would answer 504 and this test would fail.
    vi.useFakeTimers();

    const runJobs = vi.fn<typeof runSchedulerJobs>(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                runId: 'mock-run-1',
                timestamp: new Date().toISOString(),
                totalJobs: 1,
                successfulJobs: 1,
                failedJobs: 0,
                results: [
                  {
                    jobName: 'slow-but-under-ceiling',
                    success: true,
                    examined: 3,
                    acted: 1,
                    durationMs: CRON_TIMEOUT_MS - 1,
                  },
                ],
              }),
            CRON_TIMEOUT_MS - 1
          )
        )
    );
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });

    const pending = handleCronRequest(req, { runJobs });
    await vi.advanceTimersByTimeAsync(CRON_TIMEOUT_MS - 1);
    const res = await pending;

    expect(runJobs).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('hands runSchedulerJobs a live, un-aborted signal for a normal request', async () => {
    const runJobs = vi.fn<typeof runSchedulerJobs>(async () => ({
      success: true,
      runId: 'mock-run-1',
      timestamp: new Date().toISOString(),
      totalJobs: 0,
      successfulJobs: 0,
      failedJobs: 0,
      results: [],
    }));
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });

    const res = await handleCronRequest(req, { runJobs });

    const signalArg = runJobs.mock.calls[0][2];
    expect(signalArg).toBeInstanceOf(AbortSignal);
    expect(signalArg?.aborted).toBe(false);
    expect(res.status).toBe(200);
  });
});
