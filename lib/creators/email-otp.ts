import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { verification } from '@/db/auth-schema';
import { providerFromEnv } from '@/lib/notifications';
import type { EmailMessage } from '@/lib/notifications';

/**
 * Email OTP for the credentials step (phase 3, PR 2).
 *
 * The credentials form writes the creator's real email exactly once
 * (`CredentialsAlreadySetError` makes the write one-shot), and every offer
 * notification afterwards rides on it — so a typo is a permanently silent
 * inbox. The fix is to prove ownership of the *candidate* address before
 * anything is stored: request a code, mail it to the candidate, and only a
 * correct code lets the credentials route perform the write (with
 * `emailVerified: true`, since the proof just happened).
 *
 * Not Better Auth's `emailOTP` plugin: its verification flows act on the
 * user's *stored* email, and here the stored value is the TikTok placeholder
 * that every provider refuses to mail. What Better Auth does contribute is
 * the `verification` table — a generic identifier/value store with an
 * expiry column that its own flows use the same way — so the code lives
 * there rather than in a new table.
 *
 * Shape of a record: `identifier = email-otp:<userId>` (one live code per
 * user — a new request replaces the old code rather than accumulating
 * guessable ones), `value` = JSON of the candidate email, a sha256 of the
 * code (never the code itself: this table is readable by anyone with the
 * database), the attempt count and the send time. `expires_at` is the
 * column, so Better Auth's own cleanup of expired rows applies.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const IDENTIFIER_PREFIX = 'email-otp:';

export function otpIdentifier(userId: string): string {
  return `${IDENTIFIER_PREFIX}${userId}`;
}

/** What `value` holds, JSON-encoded. */
interface OtpRecord {
  email: string;
  codeHash: string;
  attempts: number;
  /** Epoch ms of the last send, for the resend cooldown. */
  sentAt: number;
}

/**
 * Salted with the userId so equal codes for different users hash apart, and a
 * rainbow table over the 10^6 code space cannot be built once and reused.
 */
function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** `randomInt` is crypto-random; `Math.random` would make codes predictable. */
function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

function otpMessage(code: string): EmailMessage {
  const subject = `${code} is your verification code`;
  const text = [
    `Your verification code is ${code}.`,
    '',
    'Enter it on the account setup screen to confirm this email address.',
    'The code expires in 10 minutes. If you did not request it, ignore this message.',
  ].join('\n');
  const html = [
    '<p>Your verification code is:</p>',
    `<p style="font-size:24px;font-weight:700;letter-spacing:0.3em;font-family:monospace">${code}</p>`,
    '<p>Enter it on the account setup screen to confirm this email address.</p>',
    '<p>The code expires in 10 minutes. If you did not request it, ignore this message.</p>',
  ].join('\n');
  return { subject, html, text };
}

/** Seam for tests; the default talks to the verification table and Resend. */
export interface EmailOtpDeps {
  load: (
    identifier: string
  ) => Promise<{ value: string; expiresAt: Date } | null>;
  /** Upsert by identifier — at most one live code per user. */
  save: (identifier: string, value: string, expiresAt: Date) => Promise<void>;
  remove: (identifier: string) => Promise<void>;
  sendEmail: (to: string, message: EmailMessage) => Promise<unknown>;
  now: () => Date;
}

async function loadRow(identifier: string) {
  const rows = await db
    .select({ value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);
  return rows[0] ?? null;
}

async function saveRow(identifier: string, value: string, expiresAt: Date) {
  // Delete-then-insert rather than ON CONFLICT: `identifier` has no unique
  // constraint in Better Auth's schema, so an upsert cannot target it.
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({ identifier, value, expiresAt });
  });
}

async function removeRow(identifier: string) {
  await db.delete(verification).where(eq(verification.identifier, identifier));
}

const defaultDeps: EmailOtpDeps = {
  load: loadRow,
  save: saveRow,
  remove: removeRow,
  sendEmail: (to, message) => providerFromEnv().send(to, message),
  now: () => new Date(),
};

export type RequestOtpResult =
  { ok: true } | { ok: false; error: 'cooldown'; retryAfterMs: number };

/**
 * Issues a fresh code for `email` and mails it there. A repeat request inside
 * the cooldown is refused with how long to wait; outside it, the new code
 * replaces the old one (changing the typed address before verifying is the
 * normal correction path, so the candidate email is never pinned).
 *
 * The record is written before the mail goes out: a send that fails after a
 * successful write leaves a code nobody has, which expires — the reverse
 * order could mail a code that was never stored, which can never verify.
 * Send failures propagate to the route.
 */
export async function requestEmailOtp(
  userId: string,
  email: string,
  deps: EmailOtpDeps = defaultDeps
): Promise<RequestOtpResult> {
  const identifier = otpIdentifier(userId);
  const now = deps.now().getTime();

  const existing = await deps.load(identifier);
  if (existing && existing.expiresAt.getTime() > now) {
    const record = parseRecord(existing.value);
    if (record) {
      const elapsed = now - record.sentAt;
      if (elapsed < OTP_RESEND_COOLDOWN_MS) {
        return {
          ok: false,
          error: 'cooldown',
          retryAfterMs: OTP_RESEND_COOLDOWN_MS - elapsed,
        };
      }
    }
  }

  const code = generateCode();
  const record: OtpRecord = {
    email,
    codeHash: hashCode(userId, code),
    attempts: 0,
    sentAt: now,
  };
  await deps.save(
    identifier,
    JSON.stringify(record),
    new Date(now + OTP_TTL_MS)
  );
  await deps.sendEmail(email, otpMessage(code));
  return { ok: true };
}

export type VerifyOtpResult =
  | { ok: true }
  | {
      ok: false;
      error: 'no_code' | 'expired' | 'invalid_code' | 'too_many_attempts';
    };

/**
 * Checks `code` against the live record for this user and candidate email.
 * Success consumes the record — a code proves ownership exactly once.
 *
 * A changed email since the code was sent counts as `no_code`: the proof on
 * file is for a different address, so the caller must request a new code. It
 * is not an attempt — guessing is per-code, and this is not a guess at it.
 *
 * `peekEmailOtp` is the same checks without consuming: the code screen can
 * reject a bad OTP before the password card. The credentials write still
 * calls `verifyEmailOtp`.
 */
export async function peekEmailOtp(
  userId: string,
  email: string,
  code: string,
  deps: EmailOtpDeps = defaultDeps
): Promise<VerifyOtpResult> {
  return matchEmailOtp(userId, email, code, deps, false);
}

export async function verifyEmailOtp(
  userId: string,
  email: string,
  code: string,
  deps: EmailOtpDeps = defaultDeps
): Promise<VerifyOtpResult> {
  return matchEmailOtp(userId, email, code, deps, true);
}

async function matchEmailOtp(
  userId: string,
  email: string,
  code: string,
  deps: EmailOtpDeps,
  consume: boolean
): Promise<VerifyOtpResult> {
  const identifier = otpIdentifier(userId);
  const now = deps.now().getTime();

  const existing = await deps.load(identifier);
  if (!existing) return { ok: false, error: 'no_code' };

  const record = parseRecord(existing.value);
  if (!record) {
    // Unparseable rows are dead weight; clear so the next request is clean.
    await deps.remove(identifier);
    return { ok: false, error: 'no_code' };
  }

  if (existing.expiresAt.getTime() <= now) {
    await deps.remove(identifier);
    return { ok: false, error: 'expired' };
  }

  if (record.email.toLowerCase() !== email.toLowerCase()) {
    return { ok: false, error: 'no_code' };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    // Belt-and-braces: the increment below removes the record on the last
    // allowed failure, so this only fires on a row written by an older build.
    await deps.remove(identifier);
    return { ok: false, error: 'too_many_attempts' };
  }

  if (!codesMatch(record.codeHash, hashCode(userId, code))) {
    const attempts = record.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      // The code is burned, not just this guess: leaving it live with a
      // maxed counter would make the counter decorative.
      await deps.remove(identifier);
      return { ok: false, error: 'too_many_attempts' };
    }
    await deps.save(
      identifier,
      JSON.stringify({ ...record, attempts }),
      existing.expiresAt
    );
    return { ok: false, error: 'invalid_code' };
  }

  if (consume) await deps.remove(identifier);
  return { ok: true };
}

function parseRecord(value: string): OtpRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<OtpRecord>;
    if (
      typeof parsed.email === 'string' &&
      typeof parsed.codeHash === 'string' &&
      typeof parsed.attempts === 'number' &&
      typeof parsed.sentAt === 'number'
    ) {
      return parsed as OtpRecord;
    }
    return null;
  } catch {
    return null;
  }
}
