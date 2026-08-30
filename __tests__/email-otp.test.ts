import { describe, expect, it, vi } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  otpIdentifier,
  requestEmailOtp,
  verifyEmailOtp,
  type EmailOtpDeps,
} from '../lib/creators/email-otp';
import type { EmailMessage } from '../lib/notifications';

/**
 * Email OTP for the credentials step (phase 3, PR 2).
 *
 * The contract under test: a code proves ownership of the *candidate* email
 * exactly once, within its TTL, within five guesses, and no sooner than 60s
 * after the previous send. The code itself never touches storage — only its
 * hash does — so the store fake here is also the assertion that nothing
 * readable leaks into the verification table.
 */

const USER = 'user-1';
const EMAIL = 'creator@example.com';
const T0 = new Date('2026-03-01T12:00:00Z').getTime();

function makeDeps(nowMs: { value: number } = { value: T0 }) {
  const store = new Map<string, { value: string; expiresAt: Date }>();
  const sent: { to: string; message: EmailMessage }[] = [];

  const deps: EmailOtpDeps = {
    load: async (id) => store.get(id) ?? null,
    save: async (id, value, expiresAt) => {
      store.set(id, { value, expiresAt });
    },
    remove: async (id) => {
      store.delete(id);
    },
    sendEmail: async (to, message) => {
      sent.push({ to, message });
    },
    now: () => new Date(nowMs.value),
  };

  return { deps, store, sent, nowMs };
}

/** The 6-digit code, straight from the mail the fake provider captured. */
function codeFrom(sent: { message: EmailMessage }[]): string {
  const last = sent[sent.length - 1];
  const match = last.message.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error('no code in message');
  return match[1];
}

describe('requestEmailOtp', () => {
  it('stores a hashed record and mails the candidate address the code', async () => {
    const { deps, store, sent } = makeDeps();

    const result = await requestEmailOtp(USER, EMAIL, deps);

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);

    const code = codeFrom(sent);
    expect(code).toMatch(/^\d{6}$/);
    const row = store.get(otpIdentifier(USER))!;
    // The code is mailed, never stored — a database read must not reveal it.
    expect(row.value).not.toContain(code);
    expect(JSON.parse(row.value)).toMatchObject({ email: EMAIL, attempts: 0 });
    expect(row.expiresAt.getTime()).toBe(T0 + OTP_TTL_MS);
  });

  it('refuses a resend inside the cooldown, saying how long to wait', async () => {
    const { deps, sent, nowMs } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);

    nowMs.value = T0 + 20_000;
    const result = await requestEmailOtp(USER, EMAIL, deps);

    expect(result).toEqual({
      ok: false,
      error: 'cooldown',
      retryAfterMs: OTP_RESEND_COOLDOWN_MS - 20_000,
    });
    expect(sent).toHaveLength(1);
  });

  it('issues a fresh code after the cooldown, replacing the old one', async () => {
    const { deps, sent, nowMs } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);
    const firstCode = codeFrom(sent);

    nowMs.value = T0 + OTP_RESEND_COOLDOWN_MS;
    const result = await requestEmailOtp(USER, EMAIL, deps);

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(2);
    // The first code is dead — only the latest can verify.
    const verify = await verifyEmailOtp(USER, EMAIL, firstCode, deps);
    // (Statistically firstCode ≠ secondCode; if equal, verification succeeding
    // is correct anyway, so only assert when they differ.)
    if (firstCode !== codeFrom(sent)) {
      expect(verify).toEqual({ ok: false, error: 'invalid_code' });
    }
  });

  it('lets a corrected candidate email take over immediately after the cooldown', async () => {
    const { deps, sent, nowMs } = makeDeps();
    await requestEmailOtp(USER, 'typo@example.com', deps);

    nowMs.value = T0 + OTP_RESEND_COOLDOWN_MS;
    await requestEmailOtp(USER, EMAIL, deps);

    expect(sent[1].to).toBe(EMAIL);
    const code = codeFrom(sent);
    expect(await verifyEmailOtp(USER, EMAIL, code, deps)).toEqual({ ok: true });
  });

  it('writes the record before sending, so a failed send cannot mail an unstored code', async () => {
    const { deps, store } = makeDeps();
    deps.sendEmail = vi.fn(async () => {
      throw new Error('resend down');
    });

    await expect(requestEmailOtp(USER, EMAIL, deps)).rejects.toThrow(
      'resend down'
    );
    // The stored orphan just expires; nothing depends on it.
    expect(store.has(otpIdentifier(USER))).toBe(true);
  });
});

describe('verifyEmailOtp', () => {
  it('accepts the mailed code once, consuming the record', async () => {
    const { deps, store, sent } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);
    const code = codeFrom(sent);

    expect(await verifyEmailOtp(USER, EMAIL, code, deps)).toEqual({ ok: true });
    expect(store.size).toBe(0);
    // Replay is refused: the proof was spent.
    expect(await verifyEmailOtp(USER, EMAIL, code, deps)).toEqual({
      ok: false,
      error: 'no_code',
    });
  });

  it('matches the candidate email case-insensitively', async () => {
    const { deps, sent } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);

    expect(
      await verifyEmailOtp(USER, 'Creator@Example.COM', codeFrom(sent), deps)
    ).toEqual({ ok: true });
  });

  it('reports no_code when nothing was requested', async () => {
    const { deps } = makeDeps();
    expect(await verifyEmailOtp(USER, EMAIL, '123456', deps)).toEqual({
      ok: false,
      error: 'no_code',
    });
  });

  it('reports no_code for a code issued to a different address', async () => {
    const { deps, sent } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);

    const result = await verifyEmailOtp(
      USER,
      'other@example.com',
      codeFrom(sent),
      deps
    );

    // Not an attempt either — this is not a guess at the code.
    expect(result).toEqual({ ok: false, error: 'no_code' });
    expect(await verifyEmailOtp(USER, EMAIL, codeFrom(sent), deps)).toEqual({
      ok: true,
    });
  });

  it('expires the code after its TTL', async () => {
    const { deps, store, sent, nowMs } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);

    nowMs.value = T0 + OTP_TTL_MS;
    expect(await verifyEmailOtp(USER, EMAIL, codeFrom(sent), deps)).toEqual({
      ok: false,
      error: 'expired',
    });
    expect(store.size).toBe(0);
  });

  it('counts wrong guesses and burns the code on the fifth', async () => {
    const { deps, store, sent } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);
    const code = codeFrom(sent);
    const wrong = code === '000000' ? '000001' : '000000';

    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await verifyEmailOtp(USER, EMAIL, wrong, deps)).toEqual({
        ok: false,
        error: 'invalid_code',
      });
    }
    expect(await verifyEmailOtp(USER, EMAIL, wrong, deps)).toEqual({
      ok: false,
      error: 'too_many_attempts',
    });
    // Burned entirely: even the right code is now refused.
    expect(store.size).toBe(0);
    expect(await verifyEmailOtp(USER, EMAIL, code, deps)).toEqual({
      ok: false,
      error: 'no_code',
    });
  });

  it('a correct code still works after a few wrong guesses', async () => {
    const { deps, sent } = makeDeps();
    await requestEmailOtp(USER, EMAIL, deps);
    const code = codeFrom(sent);
    const wrong = code === '000000' ? '000001' : '000000';

    await verifyEmailOtp(USER, EMAIL, wrong, deps);
    await verifyEmailOtp(USER, EMAIL, wrong, deps);

    expect(await verifyEmailOtp(USER, EMAIL, code, deps)).toEqual({ ok: true });
  });
});
