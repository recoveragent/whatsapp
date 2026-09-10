import { describe, expect, it } from 'vitest';

import {
  contextFromRecoverAgentEvent,
  isRecoverAgentMirrorPayload,
  validateRecoverAgentAbandonedCheckoutEvent,
} from './abandoned-checkout-event';
import { ApiError } from './respond';

describe('validateRecoverAgentAbandonedCheckoutEvent', () => {
  it('accepts a minimal valid payload', () => {
    const parsed = validateRecoverAgentAbandonedCheckoutEvent({
      event: 'abandoned_checkout',
      checkout_id: 'abc123',
      phone: '+919876543210',
      fire_after: '2026-09-10T12:00:00.000Z',
    });

    expect(parsed.checkoutKey).toBe('abc123');
    expect(parsed.phone).toBe('919876543210');
    expect(parsed.fireAfter.toISOString()).toBe('2026-09-10T12:00:00.000Z');
  });

  it('falls back to token and defaults fire_after to now', () => {
    const before = Date.now();
    const parsed = validateRecoverAgentAbandonedCheckoutEvent({
      token: 'tok-1',
      phone: '+919876543210',
    });
    const after = Date.now();

    expect(parsed.checkoutKey).toBe('tok-1');
    expect(parsed.fireAfter.getTime()).toBeGreaterThanOrEqual(before);
    expect(parsed.fireAfter.getTime()).toBeLessThanOrEqual(after);
  });

  it('rejects missing checkout identifiers', () => {
    expect(() =>
      validateRecoverAgentAbandonedCheckoutEvent({
        phone: '+919876543210',
      }),
    ).toThrow(ApiError);
  });
});

describe('contextFromRecoverAgentEvent', () => {
  it('maps Recover Agent fields into Shopify-like context', () => {
    const context = contextFromRecoverAgentEvent({
      checkout_id: 'abc123',
      phone: '+919876543210',
      customer_name: 'Asha',
      product: "Men's Cotton Boxer - XL",
      amount: 999,
      checkout_url: 'https://store.com/checkouts/abc123',
      address1: '12 MG Road',
      city: 'Bengaluru',
      state: 'KA',
      zip: '560001',
    });

    expect(context.customerName).toBe('Asha');
    expect(context.phone).toBe('+919876543210');
    expect(context.orderItems).toBe("Men's Cotton Boxer - XL");
    expect(context.orderTotal).toBe('999');
    expect(context.checkoutUrl).toBe('https://store.com/checkouts/abc123');
    expect(context.shippingAddress).toBe('12 MG Road, Bengaluru, KA, 560001');
    expect(context.resourceKey).toBe('checkout:abc123');
  });
});

describe('isRecoverAgentMirrorPayload', () => {
  it('detects queued Recover Agent payloads', () => {
    expect(
      isRecoverAgentMirrorPayload({
        _wa_recover_agent_mirror: true,
        event: { checkout_id: 'abc123', phone: '+919876543210' },
      }),
    ).toBe(true);
    expect(isRecoverAgentMirrorPayload({ id: 123 })).toBe(false);
  });
});
