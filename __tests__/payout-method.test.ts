import { describe, expect, it, vi } from 'vitest';
import {
  maskAccountNumber,
  savePayoutMethod,
} from '@/lib/wallet/payout-method';
import type { PayoutMethodDeps } from '@/lib/wallet/payout-method';
import { ChapaError } from '@/lib/chapa/client';
import type { ChapaBank } from '@/lib/chapa/client';

/**
 * Payout method tests (KAN-70 PR 3).
 *
 * The rule under test: the bank code is validated against Chapa's own list at
 * save time, the account number is checked against that bank's stated length,
 * and only the masked form ever leaves the module.
 */

const BANKS: ChapaBank[] = [
  { code: '946', name: 'Awash Bank', accountLength: 14, isMobileMoney: false },
  { code: '855', name: 'telebirr', accountLength: 10, isMobileMoney: true },
  { code: '130', name: 'Abay Bank', accountLength: null, isMobileMoney: null },
];

function makeDeps(overrides: Partial<PayoutMethodDeps> = {}): PayoutMethodDeps {
  return {
    listBanks: vi.fn().mockResolvedValue(BANKS),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const VALID = {
  bankCode: '946',
  accountNumber: '01320811436100',
  accountName: 'Abebe Bikila',
};

describe('maskAccountNumber', () => {
  it('keeps only the last four digits', () => {
    expect(maskAccountNumber('01320811436100')).toBe('••••6100');
  });
});

describe('savePayoutMethod', () => {
  it('answers gateway_unavailable in mock mode', async () => {
    const deps = makeDeps({ listBanks: vi.fn().mockResolvedValue(null) });
    expect(await savePayoutMethod('c1', VALID, deps)).toEqual({
      ok: false,
      reason: 'gateway_unavailable',
    });
  });

  it('answers gateway_unavailable when the banks call throws a ChapaError', async () => {
    const deps = makeDeps({
      listBanks: vi
        .fn()
        .mockRejectedValue(new ChapaError('down', 'UNAVAILABLE')),
    });
    expect(await savePayoutMethod('c1', VALID, deps)).toEqual({
      ok: false,
      reason: 'gateway_unavailable',
    });
  });

  it('rejects a bank code Chapa does not list', async () => {
    const deps = makeDeps();
    const result = await savePayoutMethod(
      'c1',
      { ...VALID, bankCode: '999' },
      deps
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'invalid')
      throw new Error('expected invalid');
    expect(result.fieldErrors.bankCode).toBeDefined();
    expect(deps.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['letters', 'abc123def456gh'],
    ['too short', '12345'],
    ['spaces', '0132 0811 4361'],
  ])('rejects an account number with %s', async (_label, accountNumber) => {
    const result = await savePayoutMethod(
      'c1',
      { ...VALID, accountNumber },
      makeDeps()
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'invalid')
      throw new Error('expected invalid');
    expect(result.fieldErrors.accountNumber).toBeDefined();
  });

  it("rejects a length that contradicts the bank's own stated account length", async () => {
    const result = await savePayoutMethod(
      'c1',
      { ...VALID, accountNumber: '123456789012' },
      makeDeps()
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'invalid')
      throw new Error('expected invalid');
    expect(result.fieldErrors.accountNumber?.[0]).toContain('14 digits');
  });

  it('tolerates any plausible length when the bank does not state one', async () => {
    const deps = makeDeps();
    const result = await savePayoutMethod(
      'c1',
      { bankCode: '130', accountNumber: '123456789', accountName: 'A B' },
      deps
    );
    expect(result.ok).toBe(true);
  });

  it('requires an account holder name', async () => {
    const result = await savePayoutMethod(
      'c1',
      { ...VALID, accountName: ' ' },
      makeDeps()
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'invalid')
      throw new Error('expected invalid');
    expect(result.fieldErrors.accountName).toBeDefined();
  });

  it('saves a bank method with the snapshot name, answering only the masked number', async () => {
    const deps = makeDeps();
    const result = await savePayoutMethod('c1', VALID, deps);
    expect(deps.upsert).toHaveBeenCalledWith('c1', {
      kind: 'bank',
      bankCode: '946',
      bankName: 'Awash Bank',
      accountNumber: VALID.accountNumber,
      accountName: 'Abebe Bikila',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.method.accountNumberMasked).toBe('••••6100');
    expect(JSON.stringify(result)).not.toContain(VALID.accountNumber);
  });

  it('classifies a mobile-money bank as telebirr', async () => {
    const deps = makeDeps();
    const result = await savePayoutMethod(
      'c1',
      { bankCode: '855', accountNumber: '0911223344', accountName: 'A B' },
      deps
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.method.kind).toBe('telebirr');
  });
});
