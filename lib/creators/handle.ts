/**
 * TikTok handle normalisation — the load-bearing half of AC-003.
 *
 * The acceptance criterion is that a handle "already registered" is rejected.
 * A unique index alone does not deliver that: Postgres compares the bytes it is
 * given, so `@BeautyByHana`, `beautybyhana` and `@@BEAUTYBYHANA` are three
 * distinct keys and all three would insert happily. Uniqueness is therefore
 * only as strong as the canonical form applied before the insert, which is why
 * KAN-21 calls this out as a decision that has to be made explicitly.
 *
 * The canonical form is `@` + lowercase. Two reasons for keeping the `@` rather
 * than storing a bare identifier:
 *
 *   - `db/seed.ts` already stores `'@demo_creator'`, and the tech spec's §4.2
 *     example payload is `"@beautybyhana"`. Matching them means no seed churn
 *     and no divergence between the documented contract and the stored value.
 *   - A handle is displayed with the `@` everywhere a human sees it, so storing
 *     it that way keeps read paths free of formatting logic.
 *
 * This module is pure and dependency-free on purpose: the server applies it
 * inside the validation schema, and the onboarding form applies it to render a
 * live preview. Both import the same function, so the preview cannot promise
 * one thing and the database store another.
 */

/**
 * The shape a *normalised* handle must have.
 *
 * TikTok usernames are 2–24 characters of letters, digits, underscore and
 * period. The pattern is deliberately written against the post-normalisation
 * value — it expects exactly one leading `@` and no uppercase — so it doubles
 * as an assertion that normalisation actually ran.
 */
export const TIKTOK_HANDLE_PATTERN = /^@[a-z0-9._]{2,24}$/;

/**
 * Reduces any user-entered spelling of a handle to its canonical form.
 *
 * Strips *every* leading `@` rather than just one: `@@hana` is a plausible
 * paste artefact, and leaving the second `@` in place would create a key that
 * never collides with `@hana` — an AC-003 bypass that needs no ill intent to
 * trigger.
 *
 * Internal whitespace is removed as well. A handle cannot contain spaces, so
 * anything that survives here is a copy/paste artefact rather than a distinct
 * identifier; `TIKTOK_HANDLE_PATTERN` rejects whatever this cannot rescue.
 */
export function normalizeTiktokHandle(input: string): string {
  if (typeof input !== 'string') return '';

  const withoutWhitespace = input.replace(/\s+/g, '');
  const withoutLeadingAt = withoutWhitespace.replace(/^@+/, '');

  // An empty input stays empty rather than becoming a bare '@'. Returning '@'
  // would be a value that looks structurally valid at a glance, and the caller
  // has to reject it either way — '' fails the pattern more obviously.
  if (withoutLeadingAt === '') return '';

  return `@${withoutLeadingAt.toLowerCase()}`;
}

/**
 * Whether a *already-normalised* handle is one we will store.
 *
 * The trailing-period rule is separate from the pattern because a character
 * class cannot express "allowed anywhere except last" without duplicating the
 * whole expression.
 */
export function isValidTiktokHandle(normalized: string): boolean {
  if (!TIKTOK_HANDLE_PATTERN.test(normalized)) return false;
  // TikTok does not permit a username ending in a period.
  if (normalized.endsWith('.')) return false;
  return true;
}

/** The one place the TikTok host is spelled out. */
const TIKTOK_ORIGIN = 'https://www.tiktok.com';

/**
 * The public profile URL for a stored handle (KAN-200).
 *
 * A brand walking the product on 2026-08-20 had no way to look at the account
 * they were about to pay. Every number on a creator's card is self-reported and
 * verification is manual (the MVP's whole posture), so the profile itself is the
 * only primary source a brand has — and we were storing the exact string the URL
 * needs while never offering it.
 *
 * No new column. The canonical form is already `@` + lowercase, which is what
 * TikTok's own path segment is, so this is string concatenation rather than data.
 * It lives here, beside `normalizeTiktokHandle`, because a URL built from an
 * un-normalised handle is a link to nothing — and because one module owning the
 * host means a future change of domain is one edit.
 *
 * Returns `null` for anything not storable, so a caller renders no link rather
 * than a broken one. That can only happen for a row written before
 * `isValidTiktokHandle` gated the insert (`db/seed.ts`'s `@demo_creator` passes),
 * but a 404 offered as "View on TikTok" is worse than no link: it reads as the
 * creator not existing.
 */
export function tiktokProfileUrl(handle: string): string | null {
  const normalized = normalizeTiktokHandle(handle);
  if (!isValidTiktokHandle(normalized)) return null;
  // The `@` is part of TikTok's path, so the canonical form drops straight in.
  return `${TIKTOK_ORIGIN}/${normalized}`;
}
