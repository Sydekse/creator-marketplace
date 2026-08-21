import { describe, expect, it } from 'vitest';
import { normalizeDatabaseUrl } from '@/db/connection-string';

describe('normalizeDatabaseUrl', () => {
  it.each(['prefer', 'require', 'verify-ca'])(
    'makes the current pg verification behavior explicit for sslmode=%s',
    (sslMode) => {
      const result = normalizeDatabaseUrl(
        `postgresql://user:secret@example.test/database?sslmode=${sslMode}`
      );

      expect(new URL(result!).searchParams.get('sslmode')).toBe('verify-full');
    }
  );

  it('preserves an explicit libpq compatibility choice', () => {
    const value =
      'postgresql://user:secret@example.test/database?uselibpqcompat=true&sslmode=require';

    expect(normalizeDatabaseUrl(value)).toBe(value);
  });

  it('leaves an already explicit verification mode unchanged', () => {
    const value =
      'postgresql://user:secret@example.test/database?sslmode=verify-full';

    expect(normalizeDatabaseUrl(value)).toBe(value);
  });

  it('allows builds without a database URL', () => {
    expect(normalizeDatabaseUrl(undefined)).toBeUndefined();
  });
});
