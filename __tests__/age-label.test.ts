import { describe, expect, it } from 'vitest';
import { ageLabel } from '../lib/dates';

describe('ageLabel', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const date = new Date('2026-08-20T11:59:30Z'); // 30s ago
    expect(ageLabel(date, now)).toBe('just now');
  });

  it('returns "just now" for the exact same instant', () => {
    expect(ageLabel(now, now)).toBe('just now');
  });

  it('returns minutes for timestamps 1–59 minutes ago', () => {
    const date = new Date('2026-08-20T11:55:00Z'); // 5 min ago
    expect(ageLabel(date, now)).toBe('5 minutes ago');
  });

  it('singular "minute ago" for exactly 1 minute', () => {
    const date = new Date('2026-08-20T11:59:00Z'); // 1 min ago
    expect(ageLabel(date, now)).toBe('1 minute ago');
  });

  it('returns hours for timestamps 1–23 hours ago', () => {
    const date = new Date('2026-08-20T09:00:00Z'); // 3h ago
    expect(ageLabel(date, now)).toBe('3 hours ago');
  });

  it('singular "hour ago" for exactly 1 hour', () => {
    const date = new Date('2026-08-20T11:00:00Z'); // 1h ago
    expect(ageLabel(date, now)).toBe('1 hour ago');
  });

  it('returns days for timestamps 1–29 days ago', () => {
    const date = new Date('2026-08-17T12:00:00Z'); // 3 days ago
    expect(ageLabel(date, now)).toBe('3 days ago');
  });

  it('uses "yesterday" for exactly 1 day (numeric: auto)', () => {
    const date = new Date('2026-08-19T12:00:00Z'); // 1 day ago
    expect(ageLabel(date, now)).toBe('yesterday');
  });

  it('uses "last month" for exactly 1 month (numeric: auto)', () => {
    const date = new Date('2026-07-20T12:00:00Z'); // 31 days ago
    expect(ageLabel(date, now)).toBe('last month');
  });

  it('returns months for 2 months ago', () => {
    const date = new Date('2026-06-20T12:00:00Z'); // 2 months ago
    expect(ageLabel(date, now)).toBe('2 months ago');
  });

  it('handles future timestamps with "in X" prefix', () => {
    const future = new Date('2026-08-20T13:00:00Z'); // 1h in the future
    expect(ageLabel(future, now)).toBe('in 1 hour');
  });

  it('returns "just now" for timestamps less than 1 minute in the future', () => {
    const future = new Date('2026-08-20T12:00:30Z'); // 30s in the future
    expect(ageLabel(future, now)).toBe('just now');
  });
});
