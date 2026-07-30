import { describe, expect, it } from 'vitest';
import { signUpSchema, signInSchema } from '../lib/validation/schemas';

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
