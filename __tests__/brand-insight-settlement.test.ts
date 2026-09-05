import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { sumSettledByCampaigns } from '@/lib/payment/escrow';
import type { db } from '@/db';

vi.mock('@/db', () => ({ db: {} }));

function client(rows: unknown[]) {
  const query = {
    select: vi.fn((selection: Record<string, unknown>) => {
      void selection;
      return query;
    }),
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn((scope: SQL) => {
      void scope;
      return query;
    }),
    groupBy: vi.fn(async () => rows),
  };
  return query;
}

describe('batch owned settlement', () => {
  it('returns bigint-safe totals without 32-bit narrowing or video/ledger multiplication', async () => {
    const query = client([
      {
        campaignId: 'a',
        paidOut: '3000000000',
        commission: '500000000',
        refunded: '42',
      },
    ]);
    const result = await sumSettledByCampaigns(
      ['a'],
      'owner',
      query as unknown as typeof db
    );
    expect(result.get('a')).toEqual({
      paidOut: 3_000_000_000,
      commission: 500_000_000,
      refunded: 42,
    });
    expect(query.select).toHaveBeenCalledTimes(1);
    const dialect = new PgDialect();
    const scope = dialect.sqlToQuery(query.where.mock.calls[0][0]);
    expect(scope.params).toEqual(['owner', 'a']);
    expect(scope.sql).toContain('"campaign"."brand_id"');
    const selection = query.select.mock.calls[0][0];
    for (const key of ['paidOut', 'commission', 'refunded']) {
      const sql = dialect.sqlToQuery(selection[key] as SQL).sql;
      expect(sql).not.toMatch(/::int\b/);
      expect(sql).toContain('sum(case when');
      expect(sql).toContain('-"ledger_entry"."amount"::bigint');
    }
  });
  it.each(['9007199254740992', '-1', 'NaN', '1.2', '', '1e2'])(
    'rejects unsafe/malformed ledger aggregate %s',
    async (paidOut) => {
      const query = client([
        { campaignId: 'a', paidOut, commission: '0', refunded: '0' },
      ]);
      await expect(
        sumSettledByCampaigns(['a'], 'owner', query as unknown as typeof db)
      ).rejects.toBeInstanceOf(RangeError);
    }
  );
  it('accepts maximum safe integer and skips database work for an empty selection', async () => {
    const query = client([
      {
        campaignId: 'a',
        paidOut: String(Number.MAX_SAFE_INTEGER),
        commission: '0',
        refunded: '0',
      },
    ]);
    expect(
      (
        await sumSettledByCampaigns(
          ['a'],
          'owner',
          query as unknown as typeof db
        )
      ).get('a')?.paidOut
    ).toBe(Number.MAX_SAFE_INTEGER);
    query.select.mockClear();
    expect(
      await sumSettledByCampaigns([], 'owner', query as unknown as typeof db)
    ).toEqual(new Map());
    expect(query.select).not.toHaveBeenCalled();
  });
});
