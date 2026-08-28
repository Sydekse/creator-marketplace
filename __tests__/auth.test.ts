import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signUpSchema, signInSchema } from '../lib/validation/schemas';

const ROOT = join(__dirname, '..');

describe('signUpSchema', () => {
  const valid = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    role: 'creator' as const,
  };

  it('accepts a valid sign-up payload', () => {
    const result = signUpSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts brand role', () => {
    const result = signUpSchema.safeParse({ ...valid, role: 'brand' });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = signUpSchema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = signUpSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '123' });
    expect(result.success).toBe(false);
  });

  it('rejects admin role sign-up', () => {
    const result = signUpSchema.safeParse({ ...valid, role: 'admin' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects undefined role', () => {
    const result = signUpSchema.safeParse({ ...valid, role: undefined });
    expect(result.success).toBe(false);
  });
});

describe('signInSchema', () => {
  const valid = {
    email: 'test@example.com',
    password: 'password123',
  };

  it('accepts a valid sign-in payload', () => {
    const result = signInSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = signInSchema.safeParse({ ...valid, email: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = signInSchema.safeParse({ ...valid, email: 'bad' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = signInSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = signInSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TikTok Login Kit wiring', () => {
  it('registers TikTok only when both env keys exist', () => {
    const source = readFileSync(join(ROOT, 'lib/auth.ts'), 'utf8');
    expect(source).toContain('clientId: process.env.TIKTOK_CLIENT_KEY');
    expect(source).toContain('clientKey: process.env.TIKTOK_CLIENT_KEY');
    expect(source).toContain('TIKTOK_CLIENT_SECRET');
    expect(source).toContain('socialProviders');
  });

  it('offers Continue with TikTok on sign-up and sign-in', () => {
    const signUp = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/page.tsx'),
      'utf8'
    );
    const signIn = readFileSync(
      join(ROOT, 'app/(auth)/sign-in/sign-in-form.tsx'),
      'utf8'
    );
    expect(signUp).toContain('ContinueWithTiktok');
    expect(signUp).toContain("role === 'creator'");
    // Sign-up keeps the demo fallback; sign-in shows the button disabled
    // during the sandbox testing phase.
    expect(signUp).toContain('onDemoFallback');
    expect(signIn).toContain('disabledNote');
    expect(signIn).toContain('ContinueWithTiktok');

    const cta = readFileSync(
      join(ROOT, 'components/auth/continue-with-tiktok.tsx'),
      'utf8'
    );
    expect(cta).toContain('signIn.social');
    expect(cta).toContain('TIKTOK_OAUTH_ENABLED');
  });
});
