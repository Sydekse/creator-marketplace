import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';

export interface JobRunOutput {
  examined: number;
  acted: number;
}

export function extractSafeErrorDetails(err: unknown) {
  let name = 'Error';
  let code = 'UNKNOWN_ERROR';
  let message = 'An unknown error occurred';
  const context: Record<string, unknown> = {};

  if (err instanceof Error) {
    name = err.name;
    message = err.message;
  } else if (typeof err === 'string') {
    message = err;
  } else if (typeof err === 'object' && err !== null) {
    if ('name' in err && typeof err.name === 'string') name = err.name;
    if ('message' in err && typeof err.message === 'string')
      message = err.message;
  }

  if (typeof err === 'object' && err !== null) {
    if (
      'code' in err &&
      (typeof err.code === 'string' || typeof err.code === 'number')
    ) {
      code = String(err.code);
    }
    if ('dealId' in err) context.dealId = err.dealId;
    if ('campaignId' in err) context.campaignId = err.campaignId;
  }

  // Emails with international characters, IDN domains, and single-letter TLDs
  // (user@bücher.de, user@a.b) were invisible to the ASCII-only pattern. The
  // accepted limit is emails only: scrubbing TikTok handles would also mangle
  // @-prefixed context in legitimately useful error text.
  //
  // Accepted, documented divergence from lib/audit/redact.ts (M7): that module
  // also redacts phone/SSN/birth/address, but it guards audit rows built from
  // request bodies. Scheduler logs never contain row content — jobs report
  // counts and whitelisted ids — so no such field can reach this log today. If
  // a future job ever logs row-derived context, it must reuse that redactor
  // rather than widen this regex.
  const safeMessage = message.replace(
    /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    '***@***.***'
  );
  return { name, code, message: safeMessage, context };
}

/**
 * Serializes a log payload into a single JSON line that cannot throw on the
 * values error handling produces.
 *
 * One JSON object per console call is what Vercel's Log Drain can field-parse
 * (searchable `event`/`job`/`durationMs` instead of prose), and JSON escaping
 * neutralizes CR/LF log injection (CWE-117) by construction.
 *
 * BigInts become strings and cyclic references are replaced with a marker, so
 * a hostile error property (a circular `dealId`, a BigInt `campaignId`)
 * cannot destroy the failure log it lives in — the failure mode where the
 * catch itself becomes the 500.
 *
 * Not a silver bullet: a value with a throwing getter or `toJSON` can still
 * make `JSON.stringify` throw. That is contained two layers out — the
 * harness's defensive per-job catch and the route catch — so the run and the
 * response survive; only the detail line degrades.
 */
export function toLogString(fields: Record<string, unknown>): string {
  // The set is never pruned, so a reference repeated between siblings is
  // marked `[Circular]` as well. Scheduler payloads are flat, so the false
  // positive cannot fire today; a stack-based ancestor set would be the fix
  // if that ever changes.
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };

  return JSON.stringify(fields, replacer);
}

/**
 * A scheduled unit of work.
 *
 * KAN-38 contract (branch review finding M2): jobs must be reconciliation-
 * based — they sweep rows whose state has lapsed and apply the transition
 * only to rows that still need it. Vercel never retries failed crons and can
 * deliver duplicate runs, so a duplicate must observe an already-terminal row
 * and skip it (a TransitionError on it is a no-op, not a run failure), and
 * all comparisons must be run-time-relative (`expires_at <= now()`, never
 * midnight math) because Hobby schedules fire up to ±59 minutes inside the
 * scheduled hour.
 */
export interface Job {
  name: string;
  run: (signal?: AbortSignal) => Promise<JobRunOutput>;
}

/**
 * Why a job's result row carries no success. `ABORTED` means the run was
 * interrupted before the job's work could be trusted; `JOB_EXECUTION_FAILED`
 * means the job itself rejected. The union keeps callers from inventing
 * labels the scheduler never produces.
 */
export type JobFailureReason = 'ABORTED' | 'JOB_EXECUTION_FAILED';

export interface JobResult {
  jobName: string;
  success: boolean;
  examined: number;
  acted: number;
  durationMs: number;
  error?: JobFailureReason;
}

export interface SchedulerRunResult {
  success: boolean;
  runId: string;
  timestamp: string;
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  results: JobResult[];
}

export interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export function verifyCronSecret(
  request: Request,
  env: Record<string, string | undefined> = process.env
): boolean {
  const secret = env.CRON_SECRET;
  if (!secret || secret.trim() === '') {
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (typeof authHeader !== 'string') {
    return false;
  }

  const match = authHeader.match(/^bearer +(.+)$/i);
  if (!match) {
    return false;
  }

  const token = match[1];
  const expectedToken = secret.trim();

  const expectedHash = createHash('sha256').update(expectedToken).digest();
  const providedHash = createHash('sha256').update(token).digest();

  return timingSafeEqual(expectedHash, providedHash);
}

export async function runSchedulerJobs(
  jobs: Job[],
  logger: Logger = console,
  signal?: AbortSignal
): Promise<SchedulerRunResult> {
  const runId = randomUUID();
  const runStart = Date.now();
  const timestamp = new Date().toISOString();
  const results: JobResult[] = [];

  // Watchdog for the timeout: resolves once the signal fires, so a job that
  // ignores the signal and never settles cannot hold the run hostage. The run
  // aborts with an ABORTED marker and the route answers 504 while the platform
  // is still within its duration budget. Never rejects, so a late abort after
  // the race has settled cannot become an unhandled rejection.
  const watchdog = new Promise<'aborted'>((resolve) => {
    if (signal?.aborted) resolve('aborted');
    else
      signal?.addEventListener('abort', () => resolve('aborted'), {
        once: true,
      });
  });

  for (const job of jobs) {
    if (signal?.aborted) {
      logger.warn?.(
        toLogString({
          level: 'warn',
          event: 'job.aborted',
          message: `[Scheduler] Aborting execution loop before job "${job.name}" due to timeout signal.`,
          job: job.name,
          runId,
        })
      );
      results.push({
        jobName: job.name,
        success: false,
        examined: 0,
        acted: 0,
        durationMs: 0,
        error: 'ABORTED',
      });
      continue;
    }

    const start = Date.now();
    try {
      // `then` with both handlers means the outcome promise can never reject:
      // a job that settles after the watchdog has already won is consumed
      // silently, so its late rejection cannot crash the process.
      const outcome = await Promise.race([
        job.run(signal).then(
          (output) => ({ status: 'done' as const, output }),
          (error) => ({ status: 'failed' as const, error })
        ),
        watchdog,
      ]);

      if (outcome === 'aborted') {
        results.push({
          jobName: job.name,
          success: false,
          examined: 0,
          acted: 0,
          durationMs: Date.now() - start,
          error: 'ABORTED',
        });
        continue;
      }

      if (outcome.status === 'failed') {
        const durationMs = Date.now() - start;
        const { name, code, message, context } = extractSafeErrorDetails(
          outcome.error
        );

        logger.error(
          toLogString({
            level: 'error',
            event: 'job.failed',
            message: `[Scheduler] Job "${job.name}" failed after ${durationMs}ms: [${name}] ${code} - ${message}`,
            job: job.name,
            name,
            code,
            durationMs,
            context,
            runId,
          })
        );

        results.push({
          jobName: job.name,
          success: false,
          examined: 0,
          acted: 0,
          durationMs,
          error: signal?.aborted ? 'ABORTED' : 'JOB_EXECUTION_FAILED',
        });
        continue;
      }

      const { examined, acted } = outcome.output;
      const durationMs = Date.now() - start;

      // The job finished its work but the run was already aborted while it
      // settled. The work happened, but a run that was interrupted cannot
      // claim successes — the summary is what an operator reads, and it must
      // not say "1/2 succeeded" for a run that timed out.
      if (signal?.aborted) {
        logger.warn?.(
          toLogString({
            level: 'warn',
            event: 'job.completed_after_abort',
            message: `[Scheduler] Job "${job.name}" completed after the run was aborted; recorded as ABORTED.`,
            job: job.name,
            runId,
          })
        );
        results.push({
          jobName: job.name,
          success: false,
          examined: 0,
          acted: 0,
          durationMs,
          error: 'ABORTED',
        });
        continue;
      }

      logger.log(
        toLogString({
          level: 'info',
          event: 'job.completed',
          message: `[Scheduler] Job "${job.name}" completed: examined ${examined} rows, acted on ${acted} rows in ${durationMs}ms`,
          job: job.name,
          examined,
          acted,
          durationMs,
          runId,
        })
      );

      results.push({
        jobName: job.name,
        success: true,
        examined,
        acted,
        durationMs,
      });
    } catch (err: unknown) {
      // Defensive: a logging/extraction failure must not escape the loop and
      // kill the remaining jobs — isolation is the point (AC-003).
      const durationMs = Date.now() - start;
      const { name, code, message } = extractSafeErrorDetails(err);

      logger.error(
        toLogString({
          level: 'error',
          event: 'job.failed',
          message: `[Scheduler] Job "${job.name}" failed after ${durationMs}ms: [${name}] ${code} - ${message}`,
          job: job.name,
          runId,
        })
      );

      results.push({
        jobName: job.name,
        success: false,
        examined: 0,
        acted: 0,
        durationMs,
        error: 'JOB_EXECUTION_FAILED',
      });
    }
  }

  const successfulJobs = results.filter((r) => r.success).length;
  const failedJobs = jobs.length - successfulJobs;
  const success = failedJobs === 0 && results.length === jobs.length;

  logger.log(
    toLogString({
      level: 'info',
      event: 'run.completed',
      message: `[Scheduler] Completed run at ${timestamp}: ${successfulJobs}/${jobs.length} jobs succeeded`,
      runId,
      durationMs: Date.now() - runStart,
      totalJobs: jobs.length,
      successfulJobs,
      failedJobs,
      success,
    })
  );

  return {
    success,
    runId,
    timestamp,
    totalJobs: jobs.length,
    successfulJobs,
    failedJobs,
    results,
  };
}
