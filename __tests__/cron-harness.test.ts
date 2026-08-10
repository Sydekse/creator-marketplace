import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSchedulerJobs, verifyCronSecret } from '../lib/scheduler/harness';
import type { Job, Logger } from '../lib/scheduler/harness';
import type { NextRequest } from 'next/server';
import { GET } from '../app/api/cron/route';
import { transitionDeal } from '../lib/deals/state-machine';
import type { Tx } from '../lib/authz';
import type { DealStatus } from '../db/schema';

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

  it('returns false when bearer scheme is lowercase but handles extra spacing (RFC 6750 strictness)', () => {
    const req1 = new Request('http://localhost/api/cron', {
      headers: { authorization: 'bearer test-secret-12345' },
    });
    const req2 = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer   test-secret-12345' },
    });
    expect(verifyCronSecret(req1, env)).toBe(false);
    expect(verifyCronSecret(req2, env)).toBe(true);
  });

  it('returns false when auth header is overly long (DoS protection)', () => {
    const req = new Request('http://localhost/api/cron', {
      headers: { authorization: `Bearer test-secret-12345${'a'.repeat(300)}` },
    });
    expect(verifyCronSecret(req, env)).toBe(false);
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

    // job1 ran successfully, then aborted before job2
    expect(job2.run).not.toHaveBeenCalled();
    expect(summary.success).toBe(false);
    expect(summary.failedJobs).toBe(1);
    expect(summary.successfulJobs).toBe(1);
    expect(summary.totalJobs).toBe(2);
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

    const hasLog = logger.logs.some((log) =>
      log.includes(
        'Job "test-job" completed: examined 10 rows, acted on 2 rows'
      )
    );
    expect(hasLog).toBe(true);

    const logText = logger.logs.join('\n');
    expect(logText).not.toMatch(/@|email|password|token|secret|user/i);
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
    expect(logger.errors[0].message).toContain(
      '[Scheduler] Job "failing-expiry" failed'
    );
    expect(logger.errors[0].message).toContain('[LeakError] LEAK_CODE');
    expect(logger.errors[0].message).not.toContain('user@example.com');
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
    expect(logger.errors[0].message).toContain('[Error] UNKNOWN_ERROR');
  });
});

describe('Route Handler /api/cron (KAN-56 AC-001, AC-002)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'route-test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 Internal Server Error when CRON_SECRET is unconfigured on server', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const req = new Request('http://localhost/api/cron', { method: 'GET' });
    const res = await GET(req as unknown as NextRequest);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.details).toBeDefined();
  });

  it('rejects GET requests without auth header with 401 Unauthorized and WWW-Authenticate header', async () => {
    const req = new Request('http://localhost/api/cron', { method: 'GET' });
    const res = await GET(req as unknown as NextRequest);

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing cron secret authorization header',
        details: {},
      },
    });
  });

  it('executes jobs and returns 200 OK for valid authenticated GET', async () => {
    const req = new Request('http://localhost/api/cron', {
      method: 'GET',
      headers: { authorization: 'Bearer route-test-secret' },
    });
    const res = await GET(req as unknown as NextRequest);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('Guarded transitions and idempotency compliance (KAN-56 AC-004, AC-005, FR-007)', () => {
  const DEAL_ID = 'd1000000-0000-0000-0000-000000000001';

  function createMockTx(
    existingDeal: { id: string; status: DealStatus } | null
  ) {
    let currentStatus = existingDeal ? existingDeal.status : 'pending';

    const resultRows = existingDeal
      ? [{ id: existingDeal.id, status: currentStatus }]
      : [];
    const limitResult = Object.assign(Promise.resolve(resultRows), {
      execute: vi.fn().mockResolvedValue(resultRows),
    });

    const executeLimit = limitResult.execute;
    const limit = vi.fn(() => limitResult);

    const forUpdate = vi.fn(() => ({ limit }));
    const whereSelect = vi.fn(() => ({ for: forUpdate }));
    const from = vi.fn(() => ({ where: whereSelect }));
    const select = vi.fn(() => ({ from }));

    const whereUpdate = vi.fn().mockImplementation(async () => []);
    const setUpdate = vi.fn().mockImplementation(({ status }) => {
      currentStatus = status;
      return { where: whereUpdate };
    });
    const update = vi.fn(() => ({ set: setUpdate }));

    const valuesInsert = vi.fn().mockResolvedValue([]);
    const insert = vi.fn(() => ({ values: valuesInsert }));

    const tx = { select, update, insert } as unknown as Tx;

    return {
      tx,
      spies: {
        select,
        forUpdate,
        limit,
        executeLimit,
        update,
        setUpdate,
        insert,
        valuesInsert,
      },
    };
  }

  it('drives state changes via transitionDeal to ensure guarded transition and deal_event creation (FR-007)', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    const result = await transitionDeal(tx, DEAL_ID, 'expired', null, {
      reason: 'Offer window elapsed',
    });

    expect(result.status).toBe('expired');
    expect(spies.setUpdate).toHaveBeenCalledWith({ status: 'expired' });
    expect(spies.valuesInsert).toHaveBeenCalledWith({
      dealId: DEAL_ID,
      fromStatus: 'pending',
      toStatus: 'expired',
      actorId: null,
      reason: 'Offer window elapsed',
    });
  });

  it('guarantees idempotency on re-running: second run on already expired deal is rejected without duplicate state/event writes (AC-005)', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'expired' });

    await expect(transitionDeal(tx, DEAL_ID, 'expired', null)).rejects.toThrow(
      'Cannot transition deal from expired to expired'
    );

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });
});
