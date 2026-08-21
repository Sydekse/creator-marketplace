const SSL_MODES_USING_CURRENT_PG_VERIFICATION = new Set([
  'prefer',
  'require',
  'verify-ca',
]);

/**
 * Preserve pg 8's certificate-verifying behavior without its deprecation
 * warning. Explicit libpq compatibility is respected when an environment has
 * deliberately opted into the upcoming weaker `require` semantics.
 */
export function normalizeDatabaseUrl(
  value: string | undefined
): string | undefined {
  if (!value) return value;

  const url = new URL(value);
  if (url.searchParams.get('uselibpqcompat') === 'true') return value;

  const sslMode = url.searchParams.get('sslmode');
  if (sslMode && SSL_MODES_USING_CURRENT_PG_VERIFICATION.has(sslMode)) {
    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  }

  return value;
}
