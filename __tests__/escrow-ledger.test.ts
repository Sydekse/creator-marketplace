import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockPaymentProvider } from '../lib/payment/mock-provider';
import { EscrowLedgerService } from '../lib/payment/ledger';
import { PaymentError } from '../lib/payment/types';

function createMockDb() {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  };

  return db;
}

describe('EscrowLedgerService', () => {
  let provider: MockPaymentProvider;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    db = createMockDb();
  });

  describe('constructor', () => {
    it('accepts db and provider', () => {
      const service = new EscrowLedgerService(db as never, provider);
      expect(service).toBeInstanceOf(EscrowLedgerService);
    });
  });

  describe('holdForCampaign', () => {
    it('throws when no accepted deals exist', async () => {
      db.select = vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }));

      const service = new EscrowLedgerService(db as never, provider);
      await expect(service.holdForCampaign('camp-1')).rejects.toThrow(
        PaymentError
      );
    });
  });

  describe('payoutForDeal', () => {
    it('throws when deal is not found', async () => {
      db.select = vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }));

      const service = new EscrowLedgerService(db as never, provider);
      await expect(service.payoutForDeal('nonexistent')).rejects.toThrow(
        PaymentError
      );
    });
  });

  describe('refundDeal', () => {
    it('throws when deal is not found', async () => {
      db.select = vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }));

      const service = new EscrowLedgerService(db as never, provider);
      await expect(service.refundDeal('nonexistent')).rejects.toThrow(
        PaymentError
      );
    });
  });
});
