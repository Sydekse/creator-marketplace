import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  handleRequestOtp,
  type OtpRouteDeps,
} from '../app/api/creators/credentials/otp/route';
import type { CurrentUser } from '../lib/auth';
import { ForbiddenError } from '../lib/authz';

/**
 * The OTP request endpoint, and the verify-before-write wiring around it
 * (phase 3, PR 2). The service itself is covered in email-otp.test.ts; these
 * tests pin the route contract — who may ask, for what, and how a cooldown
 * is reported — plus source guards on the two files whose exact behavior the
 * flow depends on.
 */

/** A TikTok sign-up mid-credentials: the placeholder still in the email slot. */
const PLACEHOLDER_USER: CurrentUser = {
  id: 'user-1',
  email: 'tiktokhandle',
  name: 'Creator',
  role: 'creator',
};

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/creators/credentials/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function routeDeps(
  overrides: Partial<OtpRouteDeps> = {}
): OtpRouteDeps & { requestOtp: ReturnType<typeof vi.fn> } {
  const requestOtp = vi.fn(async () => ({ ok: true }) as const);
  return {
    guard: async () => ({ user: PLACEHOLDER_USER }),
    requestOtp,
    ...overrides,
  } as OtpRouteDeps & { requestOtp: ReturnType<typeof vi.fn> };
}

describe('POST /api/creators/credentials/otp', () => {
  it('mails a code to the candidate address', async () => {
    const deps = routeDeps();

    const response = await handleRequestOtp(
      jsonRequest({ email: 'real@example.com' }),
      deps
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deps.requestOtp).toHaveBeenCalledWith('user-1', 'real@example.com');
  });

  it('answers a cooldown with 429 and whole-second Retry-After, rounded up', async () => {
    const deps = routeDeps();
    deps.requestOtp.mockResolvedValue({
      ok: false,
      error: 'cooldown',
      retryAfterMs: 40_500,
    });

    const response = await handleRequestOtp(
      jsonRequest({ email: 'real@example.com' }),
      deps
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('41');
    const body = await response.json();
    expect(body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('rejects a malformed email without sending anything', async () => {
    const deps = routeDeps();

    const response = await handleRequestOtp(
      jsonRequest({ email: 'not-an-email' }),
      deps
    );

    expect(response.status).toBe(422);
    expect(deps.requestOtp).not.toHaveBeenCalled();
  });

  it('refuses once a real email is already set — nothing left to verify', async () => {
    const deps = routeDeps({
      guard: async () => ({
        user: { ...PLACEHOLDER_USER, email: 'set@example.com' },
      }),
    });

    const response = await handleRequestOtp(
      jsonRequest({ email: 'other@example.com' }),
      deps
    );

    expect(response.status).toBe(422);
    expect(deps.requestOtp).not.toHaveBeenCalled();
  });

  it('refuses non-creators before reading the body', async () => {
    const deps = routeDeps({
      guard: async () => {
        throw new ForbiddenError('creator role required');
      },
    });

    const response = await handleRequestOtp(
      jsonRequest({ email: 'real@example.com' }),
      deps
    );

    expect(response.status).toBe(403);
    expect(deps.requestOtp).not.toHaveBeenCalled();
  });

  it('422s a body that is not JSON', async () => {
    const deps = routeDeps();
    const request = new Request('http://test/api/creators/credentials/otp', {
      method: 'POST',
      body: 'not json',
    });

    const response = await handleRequestOtp(request, deps);

    expect(response.status).toBe(422);
    expect(deps.requestOtp).not.toHaveBeenCalled();
  });
});

describe('verify-before-write wiring (source guards)', () => {
  const route = readFileSync(
    fileURLToPath(
      new URL('../app/api/creators/credentials/route.ts', import.meta.url)
    ),
    'utf8'
  );
  const service = readFileSync(
    fileURLToPath(new URL('../lib/creators/credentials.ts', import.meta.url)),
    'utf8'
  );

  it('the credentials route verifies the OTP before the credentials write', () => {
    // Order in the file is the order in the handler: verification appears
    // between parse and the setCreatorCredentials call.
    const verifyAt = route.indexOf('verifyEmailOtp(');
    const writeAt = route.indexOf('await setCreatorCredentials(');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(verifyAt);
  });

  it('an email in the body requires a code — the schema refuses one without', () => {
    expect(route).toMatch(
      /data\.email === undefined \|\| data\.code !== undefined/
    );
  });

  it('the email write stamps emailVerified true — the proof just happened', () => {
    expect(service).toContain('emailVerified: true');
    expect(service).not.toContain('emailVerified: false');
  });
});

describe('POST /api/creators/credentials/otp/verify', () => {
  it('peeks the code without consuming it', async () => {
    const { handlePeekOtp } =
      await import('../app/api/creators/credentials/otp/verify/route');
    const peekOtp = vi.fn(async () => ({ ok: true }) as const);
    const response = await handlePeekOtp(
      jsonRequest({ email: 'real@example.com', code: '123456' }),
      {
        guard: async () => ({ user: PLACEHOLDER_USER }),
        peekOtp,
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(peekOtp).toHaveBeenCalledWith(
      'user-1',
      'real@example.com',
      '123456'
    );
  });

  it('returns the same code errors the write path uses', async () => {
    const { handlePeekOtp } =
      await import('../app/api/creators/credentials/otp/verify/route');
    const response = await handlePeekOtp(
      jsonRequest({ email: 'real@example.com', code: '000000' }),
      {
        guard: async () => ({ user: PLACEHOLDER_USER }),
        peekOtp: async () => ({ ok: false, error: 'invalid_code' }),
      }
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.details.code[0]).toMatch(/not correct/i);
  });
});
