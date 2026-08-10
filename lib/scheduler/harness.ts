import { timingSafeEqual, createHash } from 'node:crypto';

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
  const safeMessage = message.replace(
    /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    '***@***.***'
  );
  return { name, code, message: safeMessage, context };
}

export interface Job {
  name: string;
  run: (signal?: AbortSignal) => Promise<JobRunOutput>;
}

export interface JobResult {
  jobName: string;
  success: boolean;
  examined: number;
  acted: number;
  durationMs: number;
  error?: string;
}

export interface SchedulerRunResult {
  success: boolean;
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
  const timestamp = new Date().toISOString();
  const results: JobResult[] = [];

  for (const job of jobs) {
    if (signal?.aborted) {
      logger.warn?.(
        `[Scheduler] Aborting execution loop before job "${job.name}" due to timeout signal.`
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
      const { examined, acted } = await job.run(signal);
      const durationMs = Date.now() - start;

      logger.log(
        `[Scheduler] Job "${job.name}" completed: examined ${examined} rows, acted on ${acted} rows in ${durationMs}ms`
      );

      results.push({
        jobName: job.name,
        success: true,
        examined,
        acted,
        durationMs,
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const { name, code, message, context } = extractSafeErrorDetails(err);

      const contextStr =
        Object.keys(context).length > 0
          ? ` Context: ${JSON.stringify(context)}`
          : '';

      logger.error(
        `[Scheduler] Job "${job.name}" failed after ${durationMs}ms: [${name}] ${code} - ${message}${contextStr}`
      );

      results.push({
        jobName: job.name,
        success: false,
        examined: 0,
        acted: 0,
        durationMs,
        error: signal?.aborted ? 'ABORTED' : 'JOB_EXECUTION_FAILED',
      });
    }
  }

  const successfulJobs = results.filter((r) => r.success).length;
  const failedJobs = jobs.length - successfulJobs;
  const success = failedJobs === 0 && results.length === jobs.length;

  logger.log(
    `[Scheduler] Completed run at ${timestamp}: ${successfulJobs}/${jobs.length} jobs succeeded`
  );

  return {
    success,
    timestamp,
    totalJobs: jobs.length,
    successfulJobs,
    failedJobs,
    results,
  };
}
