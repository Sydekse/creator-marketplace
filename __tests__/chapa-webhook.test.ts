import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseChapaEvent, verifyChapaSignature } from '@/lib/chapa/webhook';

/**
 * Chapa webhook tests (KAN-70).
 *
 * Signature verification is the gate in front of every money webhook, so it
 * gets the adversarial cases: right signature in either header passes, and
 * everything else — wrong secret, tampered body, truncated hex, empty
 * secret — misses without throwing. Event parsing is tolerant by design and
 * must never throw on any payload shape.
 */

const SECRET = 'whsec_test_0123456789';

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

const body = JSON.stringify({ event: 'charge.success', tx_ref: 'cmfund_1' });

describe('verifyChapaSignature', () => {
  it('accepts a body-HMAC in Chapa-Signature', () => {
    expect(
      verifyChapaSignature(body, { chapaSignature: sign(body, SECRET) }, SECRET)
    ).toBe(true);
  });

  it('accepts a secret-HMAC in x-chapa-signature', () => {
    expect(
      verifyChapaSignature(
        body,
        { xChapaSignature: sign(SECRET, SECRET) },
        SECRET
      )
    ).toBe(true);
  });

  it('accepts a body-HMAC in x-chapa-signature', () => {
    expect(
      verifyChapaSignature(
        body,
        { xChapaSignature: sign(body, SECRET) },
        SECRET
      )
    ).toBe(true);
  });

  it('rejects when neither header is present', () => {
    expect(verifyChapaSignature(body, {}, SECRET)).toBe(false);
    expect(
      verifyChapaSignature(
        body,
        { chapaSignature: null, xChapaSignature: null },
        SECRET
      )
    ).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(
      verifyChapaSignature(
        body,
        { chapaSignature: sign(body, 'wrong-secret') },
        SECRET
      )
    ).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const signature = sign(body, SECRET);
    const tampered = body.replace('cmfund_1', 'cmfund_2');
    expect(
      verifyChapaSignature(tampered, { chapaSignature: signature }, SECRET)
    ).toBe(false);
  });

  it('rejects truncated and garbage signatures without throwing', () => {
    const good = sign(body, SECRET);
    for (const bad of [good.slice(0, 32), 'zz'.repeat(32), '', 'x']) {
      expect(verifyChapaSignature(body, { chapaSignature: bad }, SECRET)).toBe(
        false
      );
    }
  });

  it('rejects everything when the secret is empty (unconfigured)', () => {
    expect(
      verifyChapaSignature(body, { chapaSignature: sign(body, '') }, '')
    ).toBe(false);
  });
});

describe('parseChapaEvent', () => {
  it.each([
    // [description, payload, expected kind/status/txRef]
    [
      'charge.success transaction',
      { event: 'charge.success', status: 'success', tx_ref: 'cmfund_1' },
      { kind: 'transaction', status: 'success', txRef: 'cmfund_1' },
    ],
    [
      'transfer payout via type discriminator',
      { type: 'Transfer', status: 'success', reference: 'CHA-1' },
      { kind: 'payout', status: 'success', txRef: null },
    ],
    [
      'payout.success event name',
      { event: 'payout.success', status: 'success', tx_ref: 'cmwd_1' },
      { kind: 'payout', status: 'success', txRef: 'cmwd_1' },
    ],
    [
      'refund event',
      { event: 'refund.processed', status: 'success', tx_ref: 'cmfund_1' },
      { kind: 'refund', status: 'success', txRef: 'cmfund_1' },
    ],
    [
      'bare tx_ref with no discriminator defaults to transaction',
      { status: 'success', tx_ref: 'cmfund_1' },
      { kind: 'transaction', status: 'success', txRef: 'cmfund_1' },
    ],
    [
      'unrecognised discriminator',
      { event: 'subscription.created', status: 'active' },
      { kind: 'unknown', status: 'active', txRef: null },
    ],
  ] as const)('classifies %s', (_desc, payload, expected) => {
    const event = parseChapaEvent(payload);
    expect(event.kind).toBe(expected.kind);
    expect(event.status).toBe(expected.status);
    expect(event.txRef).toBe(expected.txRef);
    expect(event.raw).toBe(payload);
  });

  it('carries the provider reference through', () => {
    const event = parseChapaEvent({
      event: 'charge.success',
      tx_ref: 'cmfund_1',
      reference: 'CHA-REF-9',
    });
    expect(event.providerRef).toBe('CHA-REF-9');
  });

  it.each([null, undefined, 'a string', 42, [], { event: 7 }])(
    'never throws — %s becomes an unknown event',
    (payload) => {
      const event = parseChapaEvent(payload);
      expect(event.kind).toBe('unknown');
      expect(event.txRef).toBeNull();
      expect(event.raw).toBe(payload);
    }
  );
});
