import { describe, expect, it, vi } from 'vitest';
import {
  FUNDING_SESSION_TTL_MS,
  expireFundingSessions,
} from '@/lib/campaigns/expire-funding-sessions';

/**
 * Session-expiry sweep tests (KAN-70). The job is one conditional UPDATE;
 * what is worth pinning is the cutoff arithmetic (24 h, run-time-relative
 * per the KAN-38 contract — never midnight math) and the count passthrough.
 */
describe('expireFundingSessions', () => {
  it('expires sessions older than 24 hours, relative to now', async () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const expireStale = vi.fn().mockResolvedValue(3);
    const result = await expireFundingSessions({ expireStale, now: () => now });

    expect(expireStale).toHaveBeenCalledWith(
      new Date(now.getTime() - FUNDING_SESSION_TTL_MS)
    );
    expect(result).toEqual({ examined: 3, acted: 3 });
  });

  it('a quiet sweep acts on nothing', async () => {
    const expireStale = vi.fn().mockResolvedValue(0);
    const result = await expireFundingSessions({
      expireStale,
      now: () => new Date(),
    });
    expect(result).toEqual({ examined: 0, acted: 0 });
  });

  it('is a 24-hour TTL', () => {
    expect(FUNDING_SESSION_TTL_MS).toBe(86_400_000);
  });
});
