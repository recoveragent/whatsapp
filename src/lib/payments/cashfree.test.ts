import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cashfreeRequest,
  normalizeCashfreeLink,
  validCashfreeSignature,
} from './cashfree';
import { verifiedLinkOutcome } from './razorpay';

afterEach(() => vi.unstubAllGlobals());
describe('Cashfree collection adapter', () => {
  const link = {
    link_id: 'collection',
    link_url: 'https://payments.cashfree.com/links/test',
    link_status: 'PAID',
    link_currency: 'INR',
    link_amount: 199.99,
    link_amount_paid: 199.99,
  };
  const expected = {
    id: 'collection',
    provider_link_id: 'collection',
    amount_paise: 19999,
  };
  it('confirms only the full matching collection, converting rupees to paise', () => {
    expect(verifiedLinkOutcome(normalizeCashfreeLink(link), expected)).toBe(
      'paid'
    );
    expect(
      verifiedLinkOutcome(
        normalizeCashfreeLink({ ...link, link_amount_paid: 1 }),
        expected
      )
    ).toBeNull();
    expect(() =>
      verifiedLinkOutcome(
        normalizeCashfreeLink({ ...link, link_id: 'other' }),
        expected
      )
    ).toThrow();
    expect(() =>
      verifiedLinkOutcome(
        normalizeCashfreeLink({ ...link, link_currency: 'USD' }),
        expected
      )
    ).toThrow();
    expect(() =>
      normalizeCashfreeLink({ ...link, link_amount: NaN })
    ).toThrow();
  });
  it.each([
    ['EXPIRED', 'expired'],
    ['CANCELLED', 'failed'],
    ['ACTIVE', null],
    ['PARTIALLY_PAID', null],
  ])(
    'handles %s without mistaking a failed attempt for cancellation',
    (status, outcome) => {
      expect(
        verifiedLinkOutcome(
          normalizeCashfreeLink({ ...link, link_status: status! }),
          expected
        )
      ).toBe(outcome);
    }
  );
  it('verifies timestamp plus the exact raw body with the client secret', () => {
    const raw = '{"type":"PAYMENT_LINK_EVENT"}';
    const timestamp = '1792400000000';
    const signature = createHmac('sha256', 'secret')
      .update(timestamp + raw)
      .digest('base64');
    expect(validCashfreeSignature(raw, timestamp, signature, 'secret')).toBe(
      true
    );
    expect(
      validCashfreeSignature(raw + ' ', timestamp, signature, 'secret')
    ).toBe(false);
    expect(
      validCashfreeSignature(raw, timestamp + '1', signature, 'secret')
    ).toBe(false);
    expect(validCashfreeSignature(raw, timestamp, signature, 'wrong')).toBe(
      false
    );
    expect(validCashfreeSignature(raw, '', '', 'secret')).toBe(false);
  });
  it.each([
    ['production', 'https://api.cashfree.com'],
    ['sandbox', 'https://sandbox.cashfree.com'],
  ] as const)(
    'uses the %s API, authentication, version and idempotency key',
    async (environment, origin) => {
      const fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => link });
      vi.stubGlobal('fetch', fetch);
      await cashfreeRequest(
        { client_id: 'app', client_secret: 'secret', environment },
        'links',
        { link_amount: 199.99 },
        'collection'
      );
      expect(fetch).toHaveBeenCalledWith(
        `${origin}/pg/links`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-client-id': 'app',
            'x-client-secret': 'secret',
            'x-api-version': '2026-01-01',
            'x-idempotency-key': 'collection',
          }),
          body: '{"link_amount":199.99}',
          signal: expect.any(AbortSignal),
        })
      );
    }
  );
  it('does not leak provider response details on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 })
    );
    await expect(
      cashfreeRequest(
        {
          client_id: 'app',
          client_secret: 'secret',
          environment: 'production',
        },
        'links/test'
      )
    ).rejects.toThrow('Cashfree request failed (401)');
  });
});
