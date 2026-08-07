/**
 * Offset paging, shared by every admin list.
 *
 * Extracted from `lib/creators/verification-queue.ts` on KAN-23, when the
 * awaiting-tier list became the second caller. Nothing here is queue-specific —
 * it is the `?page=` convention plus the clamps that keep a hand-edited URL from
 * asking Postgres for ten thousand rows — and leaving it in a module named for
 * one particular queue would have meant either importing paging helpers out of
 * an unrelated file or growing a second copy of the same four functions.
 */

/** Rows per page in the admin UI. */
export const PAGE_SIZE = 50;

/** Ceiling on a caller-supplied `limit`, so a URL cannot ask for the whole table. */
export const MAX_PAGE_SIZE = 100;

/**
 * The `?page=` value, normalised.
 *
 * Everything unusable — absent, zero, negative, `abc`, `Infinity`, or the array
 * Next hands back when the key appears twice — collapses to page 1 rather than
 * erroring. A bad page number in a URL is a typo or a stale bookmark, and an
 * admin list has nothing to hide behind an error page.
 */
export function pageFromParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (value === undefined || value.trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/** Where page `n` starts. Page 1 is offset 0. */
export function offsetForPage(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return PAGE_SIZE;
  const floored = Math.floor(limit);
  if (floored < 1) return 1;
  return Math.min(floored, MAX_PAGE_SIZE);
}

export function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}
