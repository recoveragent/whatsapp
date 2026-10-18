import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  razorpayRequest,
  validPaymentSignature,
  verifiedLinkOutcome,
} from './razorpay';

afterEach(() => vi.unstubAllGlobals());

describe('Razorpay payment verification', () => {
  const expected = {
    id: 'collection-1',
    provider_link_id: 'plink_1',
    amount_paise: 19900,
  };
  const link = {
    id: 'plink_1',
    reference_id: 'collection-1',
    amount: 19900,
    amount_paid: 19900,
    currency: 'INR',
    status: 'paid',
    short_url: 'https://rzp.io/rzp/test',
  };
  it('verifies the exact raw body and rejects missing, malformed and forged signatures', () => {
    const raw = '{"event":"payment_link.paid"}';
    const signature = createHmac('sha256', 'secret').update(raw).digest('hex');
    expect(validPaymentSignature(raw, signature, 'secret')).toBe(true);
    expect(validPaymentSignature(raw + ' ', signature, 'secret')).toBe(false);
    for (const invalid of ['', 'xx', 'a'.repeat(64), 'a'.repeat(63)])
      expect(validPaymentSignature(raw, invalid, 'secret')).toBe(false);
  });
  it('only confirms full payment of the exact collection amount', () => {
    expect(verifiedLinkOutcome(link, expected)).toBe('paid');
    expect(
      verifiedLinkOutcome(
        { ...link, status: 'created', amount_paid: 0 },
        expected
      )
    ).toBeNull();
    expect(
      verifiedLinkOutcome({ ...link, amount_paid: 100 }, expected)
    ).toBeNull();
    expect(
      verifiedLinkOutcome({ ...link, status: 'partially_paid' }, expected)
    ).toBeNull();
  });
  it('rejects mismatched account collections, references, currencies and amounts', () => {
    for (const mismatch of [
      { id: 'plink_other' },
      { reference_id: 'collection_other' },
      { currency: 'USD' },
      { amount: 20000 },
    ])
      expect(() =>
        verifiedLinkOutcome({ ...link, ...mismatch }, expected)
      ).toThrow();
  });
  it('distinguishes expiry and cancellation from a retryable unsuccessful attempt', () => {
    expect(verifiedLinkOutcome({ ...link, status: 'expired' }, expected)).toBe(
      'expired'
    );
    expect(
      verifiedLinkOutcome({ ...link, status: 'cancelled' }, expected)
    ).toBe('failed');
    expect(
      verifiedLinkOutcome({ ...link, status: 'created' }, expected)
    ).toBeNull();
  });
  it('sends credentials only to Razorpay with exact rupees-to-paise payload and timeout', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => link });
    vi.stubGlobal('fetch', fetch);
    await razorpayRequest(
      { key_id: 'key', key_secret: 'secret' },
      'payment_links',
      { amount: 19900, accept_partial: false }
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/payment_links',
      expect.objectContaining({
        method: 'POST',
        body: '{"amount":19900,"accept_partial":false}',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      })
    );
  });
  it('does not expose Razorpay response details or credentials in errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 })
    );
    await expect(
      razorpayRequest({ key_id: 'key', key_secret: 'secret' }, 'payment_links')
    ).rejects.toThrow('Razorpay request failed (401)');
  });
});
