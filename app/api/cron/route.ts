import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  extractSafeErrorDetails,
  runSchedulerJobs,
  toLogString,
  verifyCronSecret,
} from '@/lib/scheduler/harness';
import type { Job, SchedulerRunResult } from '@/lib/scheduler/harness';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Ten seconds of margin under the 300s platform ceiling (`maxDuration`): a run
 * that outlives its budget is aborted by us and answered with a proper 504
 * before the platform kills it. Exported so tests can pin the boundary
 * (sub-ceiling runs must complete, over-ceiling runs must 504).
 */
export const CRON_TIMEOUT_MS = 290000;
const CRON_TIMEOUT_ABORT_REASON = 'Internal execution timeout';

// Jobs will be imported and registered here in future tickets (e.g. KAN-38)
const jobsToRun: Job[] = [];

/** Injectable for tests — the only seam the route exposes. */
export interface CronRouteDeps {
  runJobs?: typeof runSchedulerJobs;
}

export async function handleCronRequest(
  request: Request,
  deps: CronRouteDeps = {}
): Promise<Response> {
  const runJobs = deps.runJobs ?? runSchedulerJobs;

  // Declared outside the try so the catch can read it, and aborted by either
  // end: our own ceiling (290s) or the platform aborting the request before
  // we finish. Jobs receive one signal that fires on both.
  const controller = new AbortController();
  const signal =
    typeof AbortSignal.any === 'function'
      ? AbortSignal.any([request.signal, controller.signal])
      : controller.signal;

  const timerId = setTimeout(() => {
    controller.abort(new Error(CRON_TIMEOUT_ABORT_REASON));
  }, CRON_TIMEOUT_MS);

  try {
    // Fails closed, and deliberately no distinct response when the secret is
    // unconfigured: a 500 here would answer an unauthenticated probe with the
    // server's config state (an oracle). The misconfiguration is loud in the
    // logs instead, and the request still gets the AC-002 401.
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.trim() === '') {
      console.error(
        toLogString({
          level: 'error',
          event: 'cron.secret_unconfigured',
          message:
            '[Cron Route] CRON_SECRET is not configured; every run is being rejected.',
        })
      );
    }

    if (!verifyCronSecret(request)) {
      return NextResponse.json(errorResponse(ErrorCode.UNAUTHORIZED, {}), {
        status: ErrorHttpStatus[ErrorCode.UNAUTHORIZED],
        headers: { 'WWW-Authenticate': 'Bearer realm="cron"' },
      });
    }

    let summary: SchedulerRunResult;

    try {
      summary = await runJobs(jobsToRun, console, signal);
    } finally {
      clearTimeout(timerId);
    }

    if (signal.aborted) {
      console.error(
        toLogString({
          level: 'error',
          event: 'cron.timeout',
          message: '[Cron Route] Run aborted after timeout',
          runId: summary.runId,
          summary,
        })
      );
      return NextResponse.json(errorResponse(ErrorCode.CRON_TIMEOUT, {}), {
        status: ErrorHttpStatus[ErrorCode.CRON_TIMEOUT],
      });
    }

    if (!summary.success) {
      console.error(
        toLogString({
          level: 'error',
          event: 'cron.partial_failure',
          message: '[Cron Route] Run completed with failed jobs',
          runId: summary.runId,
          summary,
        })
      );
      return NextResponse.json(
        errorResponse(ErrorCode.CRON_PARTIAL_FAILURE, {}),
        { status: ErrorHttpStatus[ErrorCode.CRON_PARTIAL_FAILURE] }
      );
    }

    return NextResponse.json(summary, { status: 200 });
  } catch (error: unknown) {
    const { name, code, message, context } = extractSafeErrorDetails(error);

    // A rejection that escaped the loop while the run was aborted is a
    // timeout, not an internal failure — the platform or our own timer ended
    // the execution, and a timeout must map to 504, never 500. Judged from
    // the signal rather than the error message: the timer aborts with a plain
    // `Error`, not a `DOMException`.
    if (name === 'AbortError' || signal.aborted) {
      // The harness is not supposed to reject, so when one escapes while the
      // run is aborted it is worth keeping — but the status is decided by the
      // signal: a timeout answers 504, never 500.
      console.error(
        toLogString({
          level: 'error',
          event: 'cron.timeout',
          message: `[Cron Route] Run aborted after timeout; unexpected rejection: [${name}] ${code} - ${message}`,
          name,
          code,
        })
      );

      return NextResponse.json(errorResponse(ErrorCode.CRON_TIMEOUT, {}), {
        status: ErrorHttpStatus[ErrorCode.CRON_TIMEOUT],
      });
    }

    console.error(
      toLogString({
        level: 'error',
        event: 'cron.internal_error',
        message: `[Cron Route Error] Unhandled infrastructure failure: [${name}] ${code} - ${message}`,
        name,
        code,
        context,
      })
    );

    return NextResponse.json(
      errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, {}),
      { status: ErrorHttpStatus[ErrorCode.INTERNAL_SERVER_ERROR] }
    );
  } finally {
    clearTimeout(timerId);
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}
