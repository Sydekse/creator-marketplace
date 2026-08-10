import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { runSchedulerJobs, verifyCronSecret } from '@/lib/scheduler/harness';
import type { Job, SchedulerRunResult } from '@/lib/scheduler/harness';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Jobs will be imported and registered here in future tickets (e.g. KAN-38)
const jobsToRun: Job[] = [];

async function handleCronRequest(request: Request) {
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

    const controller = new AbortController();
    const timeoutMs = 290000;

    // Await jobs directly. The setTimeout will call controller.abort() if it takes too long,
    // which will cause runSchedulerJobs to gracefully terminate before Vercel kills us.
    const timerId = setTimeout(() => {
      controller.abort(new Error('Internal execution timeout'));
    }, timeoutMs);

    let summary: SchedulerRunResult;

    try {
      summary = await runSchedulerJobs(jobsToRun, console, controller.signal);
    } catch (error: unknown) {
      throw error;
    } finally {
      if (timerId) clearTimeout(timerId);
    }

    if (controller.signal.aborted) {
      return NextResponse.json(
        {
          error: {
            code: 'CRON_TIMEOUT',
            message: 'Execution timed out after 290s',
            details: summary,
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
    let errorName = 'Error';
    let errorCode = 'UNKNOWN_ERROR';
    const context: Record<string, unknown> = {};

    if (typeof error === 'object' && error !== null) {
      if ('name' in error && typeof error.name === 'string')
        errorName = error.name;
      if (
        'code' in error &&
        (typeof error.code === 'string' || typeof error.code === 'number')
      )
        errorCode = String(error.code);
      if ('dealId' in error) context.dealId = error.dealId;
    }

    const contextStr =
      Object.keys(context).length > 0
        ? ` Context: ${JSON.stringify(context)}`
        : '';

    console.error(
      `[Cron Route Error] Unhandled infrastructure failure: [${errorName}] ${errorCode}${contextStr}`
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
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}
