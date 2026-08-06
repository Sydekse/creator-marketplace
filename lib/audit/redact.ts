/**
 * Keeps secrets and unnecessary PII out of `audit_log.detail` (KAN-52, NFR-010).
 *
 * `detail` is free-form jsonb carrying before/after context, which makes it the
 * one column in the schema that can hold anything a caller hands it. The obvious
 * place to be careful is the call site — and that is exactly why the check is
 * not there. Twelve tickets will write audit rows; the one that spreads a whole
 * row into `detail` and picks up a password hash with it will not be the one
 * that remembered to think about this. So redaction runs at the write path, in
 * `withAdminAudit`, where forgetting is not an available option.
 *
 * Everything here is pure and synchronous: this runs inside the caller's
 * transaction, so it must not do I/O and must not throw.
 */

/**
 * Redacted, not dropped. That a `password` key was present is itself worth
 * knowing when reading the log back; its value never is.
 */
const REDACTED = '[redacted]';
const TRUNCATED = '…[truncated]';

/**
 * Matched against a key normalised to lowercase alphanumerics, so `apiKey`,
 * `api_key` and `API-KEY` are one rule rather than three.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Substring matches. Anything containing one of these is redacted, which is the
 * right bias: a wrongly redacted field costs one unreadable value in a log,
 * while a wrongly kept one is a leaked secret in a table nobody can edit.
 */
const SENSITIVE_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
  'authorization',
  'cookie',
  'signature',
  'apikey',
  'accesskey',
  'privatekey',
  'secretkey',
  'session',
  'email',
  'phone',
  'ssn',
  'birth',
  'address',
] as const;

/**
 * Exact matches only, because as substrings these are wrong more often than
 * right: `key` is inside `keyword` and `monkey`, `ip` is inside `description`
 * and `recipient`, `pin` is inside `pinned`, and `auth` is inside `author` and
 * `authorId` — the last of which is a field the audit log positively wants.
 */
const SENSITIVE_EXACT = ['auth', 'key', 'otp', 'pin', 'ip', 'dob'] as const;

export function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  if ((SENSITIVE_EXACT as readonly string[]).includes(k)) return true;
  return SENSITIVE_SUBSTRINGS.some((s) => k.includes(s));
}

/**
 * Caps. `detail` is context for a human reading the log, not a data export —
 * these bound what one row can cost without needing anyone to remember to be
 * brief.
 */
const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 512;
const MAX_KEYS_PER_OBJECT = 50;
const MAX_ARRAY_ITEMS = 20;
/** Last-resort ceiling on the whole serialized value. */
const MAX_SERIALIZED_BYTES = 8_192;

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value === null || value === undefined) return null;

  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_LENGTH
        ? value.slice(0, MAX_STRING_LENGTH) + TRUNCATED
        : value;
    case 'number':
      // NaN and ±Infinity are not JSON. Serialising them yields `null`, which
      // reads as "absent" rather than "the caller passed a broken number".
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    // A function or symbol in `detail` is a caller mistake, and one that
    // JSON.stringify would silently erase. Naming it is more useful than
    // dropping it.
    case 'function':
    case 'symbol':
      return '[unserializable]';
  }

  // Dates are the one object type worth special-casing: they are common in
  // before/after context and their JSON form is already the right one.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? '[invalid date]'
      : value.toISOString();
  }

  if (depth >= MAX_DEPTH) return TRUNCATED;

  // A cycle would make JSON.stringify throw. Throwing here would roll back the
  // admin action that was otherwise fine, so cycles are cut, not raised.
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redactValue(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) items.push(TRUNCATED);
      return items;
    }

    return redactObject(value as Record<string, unknown>, depth, seen);
  } finally {
    // Released on the way out so a value appearing twice in *sibling* branches
    // is rendered twice, not reported as circular. Only a genuine ancestor
    // cycle is caught.
    seen.delete(value as object);
  }
}

function redactObject(
  input: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_KEYS_PER_OBJECT) {
      out._truncated = true;
      break;
    }
    count++;
    // The key check comes first: a sensitive key is redacted whatever its value
    // is, including when the value is an object that would otherwise be walked.
    out[key] = isSensitiveKey(key)
      ? REDACTED
      : redactValue(value, depth + 1, seen);
  }

  return out;
}

/**
 * Sanitises `detail` for storage. Returns `null` when there is nothing to
 * store, matching the nullable column.
 *
 * The limit worth stating plainly: this matches on *key names*. A secret stored
 * under an innocent key — `{ note: 'the admin password is hunter2' }` — passes
 * straight through, and no amount of pattern matching would reliably catch it.
 * That half of NFR-010 is the vocabulary in `actions.ts` and code review; this
 * function is the half that catches the accident of spreading a whole row.
 */
export function redactDetail(
  detail: Record<string, unknown> | undefined | null
): Record<string, unknown> | null {
  if (detail === null || detail === undefined) return null;
  if (typeof detail !== 'object' || Array.isArray(detail)) return null;

  const redacted = redactObject(detail, 0, new WeakSet());
  if (Object.keys(redacted).length === 0) return null;

  // The per-field caps bound the common case; this catches the pathological one
  // (a wide, shallow object of long-but-legal strings) rather than letting a
  // single row carry an unbounded payload.
  //
  // Measured in bytes, not `.length`: `.length` counts UTF-16 code units, so a
  // detail of Amharic or emoji is ~3x its length in the bytes Postgres actually
  // stores and would slip a 24KB payload past an 8KB cap named `_bytes`.
  const serialized = JSON.stringify(redacted);
  if (
    serialized !== undefined &&
    byteLength(serialized) > MAX_SERIALIZED_BYTES
  ) {
    return oversize(redacted, byteLength(serialized));
  }

  return redacted;
}

/** UTF-8 byte length, matching what the jsonb column stores. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The fallback for an over-cap detail. Rather than throwing the whole object
 * away for a `{ _truncated, _bytes }` stub, keep the top-level scalar keys —
 * they are the readable half (a status, an id, a reason) and are individually
 * bounded by `MAX_STRING_LENGTH`, while the nested objects and arrays are what
 * make a payload large. A reader still learns what the action was about.
 */
function oversize(
  redacted: Record<string, unknown>,
  bytes: number
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (value === null || typeof value !== 'object') out[key] = value;
  }
  out._truncated = true;
  out._bytes = bytes;
  return out;
}
