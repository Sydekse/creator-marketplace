import { describe, expect, it, vi } from 'vitest';
import {
  ChapaClient,
  ChapaError,
  etbToSantim,
  santimToEtb,
} from '@/lib/chapa/client';

/**
 * Chapa client tests (KAN-70).
 *
 * The client is the only place santim↔ETB conversion and Chapa response
 * parsing live, so the tests concentrate there: conversion must be exact in
 * both directions, and every malformed / rejected / unreachable shape must
 * surface as a coded ChapaError rather than leaking into the money path.
 * All I/O goes through the injected fetch seam — no network anywhere.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successEnvelope(data: unknown): unknown {
  return { message: 'ok', status: 'success', data };
}

function clientWith(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      responder(String(input), init)
  ) as unknown as typeof fetch;
  return {
    client: new ChapaClient('CHASECK_TEST-secret', { fetchImpl }),
    fetchImpl: fetchImpl as ReturnType<typeof vi.fn>,
  };
}

describe('santimToEtb', () => {
  it.each([
    [1, '0.01'],
    [99, '0.99'],
    [100, '1.00'],
    [10_000, '100.00'],
    [123_456, '1234.56'],
    [500_000_00, '500000.00'],
  ])('%i santim → %s ETB', (santim, etb) => {
    expect(santimToEtb(santim)).toBe(etb);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects %s', (bad) => {
    expect(() => santimToEtb(bad)).toThrowError(ChapaError);
  });
});

describe('etbToSantim', () => {
  it.each([
    ['100', 10_000],
    ['100.5', 10_050],
    ['100.50', 10_050],
    ['0.01', 1],
    ['1234.56', 123_456],
    // Trailing zeros beyond two decimals are still exact.
    ['100.500', 10_050],
    [100.5, 10_050],
    [250, 25_000],
  ])('%s ETB → %i santim', (etb, santim) => {
    expect(etbToSantim(etb)).toBe(santim);
  });

  it.each([
    // Sub-santim precision is a verification failure, never rounded.
    '100.005',
    '100.999',
    '-5',
    'abc',
    '1,000',
    '',
  ])('returns null for %s', (bad) => {
    expect(etbToSantim(bad)).toBeNull();
  });

  it('round-trips every santim value it produces', () => {
    for (const santim of [1, 99, 100, 101, 10_000, 123_456]) {
      expect(etbToSantim(santimToEtb(santim))).toBe(santim);
    }
  });
});

describe('initializeTransaction', () => {
  it('POSTs the documented JSON body and returns the checkout URL', async () => {
    const { client, fetchImpl } = clientWith(() =>
      jsonResponse(
        successEnvelope({ checkout_url: 'https://checkout.chapa.co/x/123' })
      )
    );

    const result = await client.initializeTransaction({
      txRef: 'cmfund_abc',
      amountSantim: 250_000,
      email: 'brand@example.com',
      firstName: 'Bete',
      returnUrl: 'https://app.example.com/return',
      callbackUrl: 'https://app.example.com/callback',
      title: 'Creator Marketplace',
      description: 'Fund campaign: Summer Launch',
    });

    expect(result.checkoutUrl).toBe('https://checkout.chapa.co/x/123');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chapa.co/v1/transaction/initialize');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer CHASECK_TEST-secret'
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: '2500.00',
      currency: 'ETB',
      email: 'brand@example.com',
      first_name: 'Bete',
      tx_ref: 'cmfund_abc',
      return_url: 'https://app.example.com/return',
      callback_url: 'https://app.example.com/callback',
      customization: {
        title: 'Creator Marketplace',
        description: 'Fund campaign: Summer Launch',
      },
    });
  });

  it('rejects a success envelope whose data leg is not a checkout URL', async () => {
    const { client } = clientWith(() =>
      jsonResponse(successEnvelope({ nope: true }))
    );
    await expect(
      client.initializeTransaction({
        txRef: 't',
        amountSantim: 100,
        email: 'a@b.c',
        firstName: 'A',
        returnUrl: 'https://x.y',
      })
    ).rejects.toMatchObject({ name: 'ChapaError', code: 'MALFORMED' });
  });
});

describe('verifyTransaction', () => {
  it('GETs the tx_ref path and converts the amount exactly', async () => {
    const { client, fetchImpl } = clientWith(() =>
      jsonResponse(
        successEnvelope({
          status: 'Success',
          amount: '2500.00',
          currency: 'ETB',
          tx_ref: 'cmfund_abc',
          reference: 'CHA-REF-1',
          mode: 'test',
        })
      )
    );

    const result = await client.verifyTransaction('cmfund_abc');
    expect(result).toEqual({
      status: 'success',
      amountSantim: 250_000,
      currency: 'ETB',
      txRef: 'cmfund_abc',
      providerRef: 'CHA-REF-1',
      mode: 'test',
    });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('https://api.chapa.co/v1/transaction/verify/cmfund_abc');
  });

  it('surfaces an inexact amount as null instead of rounding', async () => {
    const { client } = clientWith(() =>
      jsonResponse(
        successEnvelope({
          status: 'success',
          amount: '2500.005',
          currency: 'ETB',
          tx_ref: 't',
        })
      )
    );
    const result = await client.verifyTransaction('t');
    expect(result.amountSantim).toBeNull();
  });
});

describe('listBanks', () => {
  it('maps bank ids to string codes and normalises mobile-money flags', async () => {
    const { client } = clientWith(() =>
      jsonResponse(
        successEnvelope([
          { id: 946, name: 'Awash Bank', acct_length: 14, is_mobilemoney: 0 },
          { id: '855', name: 'telebirr', acct_length: 10, is_mobilemoney: 1 },
          { id: 1, name: 'Mystery Bank' },
        ])
      )
    );
    expect(await client.listBanks()).toEqual([
      {
        code: '946',
        name: 'Awash Bank',
        accountLength: 14,
        isMobileMoney: false,
      },
      { code: '855', name: 'telebirr', accountLength: 10, isMobileMoney: true },
      {
        code: '1',
        name: 'Mystery Bank',
        accountLength: null,
        isMobileMoney: null,
      },
    ]);
  });
});

describe('createTransfer', () => {
  it('POSTs the transfer body and returns the string reference Chapa mints', async () => {
    const { client, fetchImpl } = clientWith(() =>
      jsonResponse(successEnvelope('CHA-TRANSFER-REF'))
    );
    const result = await client.createTransfer({
      txRef: 'cmwd_abc',
      amountSantim: 10_000,
      accountName: 'Abebe Bikila',
      accountNumber: '0900123456',
      bankCode: '855',
    });
    expect(result.providerRef).toBe('CHA-TRANSFER-REF');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chapa.co/v1/transfers');
    expect(JSON.parse(init.body as string)).toEqual({
      account_name: 'Abebe Bikila',
      account_number: '0900123456',
      amount: '100.00',
      currency: 'ETB',
      bank_code: '855',
      reference: 'cmwd_abc',
    });
  });

  it('tolerates an object-shaped data leg without inventing a reference', async () => {
    const { client } = clientWith(() =>
      jsonResponse(successEnvelope({ some: 'future-shape' }))
    );
    const result = await client.createTransfer({
      txRef: 'cmwd_abc',
      amountSantim: 10_000,
      accountName: 'A',
      accountNumber: '1',
      bankCode: '855',
    });
    expect(result.providerRef).toBeNull();
  });
});

describe('verifyTransfer', () => {
  it('GETs the verify path and lowercases the status', async () => {
    const { client, fetchImpl } = clientWith(() =>
      jsonResponse(
        successEnvelope({
          status: 'SUCCESS',
          tx_ref: 'cmwd_abc',
          reference: 'CHA-T-1',
          amount: '100.00',
        })
      )
    );
    const result = await client.verifyTransfer('cmwd_abc');
    expect(result).toEqual({
      status: 'success',
      txRef: 'cmwd_abc',
      providerRef: 'CHA-T-1',
      amountSantim: 10_000,
    });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('https://api.chapa.co/v1/transfers/verify/cmwd_abc');
  });
});

describe('refund', () => {
  it('POSTs form-encoded amount and reason to the refund path', async () => {
    const { client, fetchImpl } = clientWith(() =>
      jsonResponse(successEnvelope(null))
    );
    await client.refund({
      txRef: 'cmfund_abc',
      amountSantim: 50_000,
      reason: 'dispute resolved for brand',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chapa.co/v1/refund/cmfund_abc');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    const form = new URLSearchParams(init.body as string);
    expect(form.get('amount')).toBe('500.00');
    expect(form.get('reason')).toBe('dispute resolved for brand');
  });
});

describe('error mapping', () => {
  const doVerify = (client: ChapaClient) => client.verifyTransaction('t');

  it('REJECTED when the envelope status is not success', async () => {
    const { client } = clientWith(() =>
      jsonResponse({ message: 'Invalid API Key', status: 'failed' }, 401)
    );
    await expect(doVerify(client)).rejects.toMatchObject({
      code: 'REJECTED',
      httpStatus: 401,
    });
  });

  it('REJECTED when http is 4xx even with a success-shaped envelope', async () => {
    const { client } = clientWith(() => jsonResponse(successEnvelope({}), 404));
    await expect(doVerify(client)).rejects.toMatchObject({ code: 'REJECTED' });
  });

  it('UNAVAILABLE on 5xx', async () => {
    const { client } = clientWith(() => jsonResponse({ status: 'error' }, 503));
    await expect(doVerify(client)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('UNAVAILABLE when fetch itself throws', async () => {
    const { client } = clientWith(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(doVerify(client)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('UNAVAILABLE on non-JSON 5xx, MALFORMED on non-JSON 2xx', async () => {
    const html = (status: number) =>
      new Response('<html>oops</html>', { status });
    const { client: c5 } = clientWith(() => html(502));
    await expect(doVerify(c5)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const { client: c2 } = clientWith(() => html(200));
    await expect(doVerify(c2)).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('MALFORMED when the envelope is missing entirely', async () => {
    const { client } = clientWith(() => jsonResponse([1, 2, 3]));
    await expect(doVerify(client)).rejects.toMatchObject({
      code: 'MALFORMED',
    });
  });
});
