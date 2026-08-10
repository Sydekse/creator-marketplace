import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  extractSafeErrorDetails,
  runSchedulerJobs,
  verifyCronSecret,
} from '@/lib/scheduler/harness';
import type { Job, SchedulerRunResult } from '@/lib/scheduler/harness';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

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

  const timeoutMs = 290000;
  const timerId = setTimeout(() => {
    controller.abort(new Error('Internal execution timeout'));
  }, timeoutMs);

  try {
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.trim() === '') {
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Cron authorization secret is not configured on server',
            details: {},
          },
        },
        { status: 500 }
      );
    }

    if (!verifyCronSecret(request)) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing cron secret authorization header',
            details: {},
          },
        },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer' },
        }
      );
    }

    let summary: SchedulerRunResult;

    try {
      summary = await runJobs(jobsToRun, console, signal);
    } finally {
      if (timerId) clearTimeout(timerId);
    }

    if (signal.aborted) {
      return NextResponse.json(
        {
          error: {
            code: 'CRON_TIMEOUT',
            message: 'Execution timed out after 290s',
            details: summary ?? {},
          },
        },
        { status: 504 }
      );
    }

    if (!summary.success) {
      return NextResponse.json(
        {
          error: {
            code: 'CRON_PARTIAL_FAILURE',
            message: 'One or more jobs failed during execution',
            details: summary,
          },
        },
        { status: 500 }
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
      return NextResponse.json(
        {
          error: {
            code: 'CRON_TIMEOUT',
            message: 'Execution timed out after 290s',
            details: {},
          },
        },
        { status: 504 }
      );
    }

    const contextStr =
      Object.keys(context).length > 0
        ? ` Context: ${JSON.stringify(context)}`
        : '';

    console.error(
      `[Cron Route Error] Unhandled infrastructure failure: [${name}] ${code} - ${message}${contextStr}`
    );

    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unhandled infrastructure failure',
          details: {},
        },
      },
      { status: 500 }
    );
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}
