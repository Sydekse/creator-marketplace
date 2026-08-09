import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { getCurrentRightsTerms } from '../lib/deals/queries';
import { db } from '../db';
import { rightsTerms } from '../db/schema';

vi.mock('../db', () => ({
  db: {
    select: vi.fn(),
  },
}));

describe('getCurrentRightsTerms (KAN-35)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the most recent effective terms', async () => {
    const mockTerms = {
      id: 'terms-123',
      version: 'v1.0',
      body: 'Standard usage rights...',
      effectiveAt: new Date(),
    };

    const limit = vi.fn().mockResolvedValue([mockTerms]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as Mock).mockReturnValue({ from });

    const result = await getCurrentRightsTerms();

    expect(result).toEqual(mockTerms);
    expect(db.select).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith(rightsTerms);
    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('returns null if no active terms exist', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as Mock).mockReturnValue({ from });

    const result = await getCurrentRightsTerms();

    expect(result).toBeNull();
  });
});
