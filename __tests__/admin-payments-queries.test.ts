import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPaymentsForAdmin } from '@/lib/admin/payments';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  select: vi.fn(),
}));
vi.mock('@/db', () => ({ db: { select: mocks.select } }));
vi.mock('@/lib/authz', () => ({ guard: mocks.guard }));
vi.mock('@/lib/refunds/external-refund', () => ({
  issueExternalRefund: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('admin payment default aggregate queries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('starts all four aggregates before any completes, after authorization', async () => {
    const authorized = deferred<void>();
    const results = [
      deferred<object[]>(),
      deferred<object[]>(),
      deferred<object[]>(),
      deferred<object[]>(),
    ];
    const started: string[] = [];
    mocks.guard.mockReturnValue(authorized.promise);
    mocks.select.mockImplementation((fields: Record<string, unknown>) => {
      const key = Object.keys(fields)[0];
      const index = [
        'deposited',
        'withdrawn',
        'refunded',
        'commission',
      ].indexOf(key);
      const query = {
        from: () => query,
        innerJoin: () => query,
        orderBy: () => query,
        limit: () => query,
        then: (
          resolve: (rows: object[]) => void,
          reject: (e: unknown) => void
        ) => {
          started.push(key);
          return (
            index < 0 ? Promise.resolve([]) : results[index].promise
          ).then(resolve, reject);
        },
      };
      return query;
    });

    const pending = readPaymentsForAdmin();
    expect(mocks.select).not.toHaveBeenCalled();
    authorized.resolve();
    await vi.waitFor(() => {
      expect(started).toEqual(
        expect.arrayContaining([
          'deposited',
          'withdrawn',
          'refunded',
          'commission',
        ])
      );
    });
    results[0].resolve([{ deposited: 500 }]);
    results[1].resolve([{ withdrawn: 100 }]);
    results[2].resolve([{ refunded: 50 }]);
    results[3].resolve([{ commission: 25, escrowHeld: 325 }]);
    expect((await pending).totals).toEqual({
      deposited: 500,
      withdrawn: 100,
      refunded: 50,
      commission: 25,
      escrowHeld: 325,
    });
  });

  it('never constructs a query when authorization fails', async () => {
    mocks.guard.mockRejectedValue(new Error('Forbidden'));
    await expect(readPaymentsForAdmin()).rejects.toThrow('Forbidden');
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
