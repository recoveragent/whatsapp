import { describe, expect, it } from 'vitest';

import { contextFromOrder } from './extract-event-context';
import { classifyWooCommercePayment } from './payment-type';
import type { WooCommerceOrderPayload } from './types';

describe('classifyWooCommercePayment', () => {
  it('treats the cod gateway as COD regardless of payment evidence', () => {
    expect(classifyWooCommercePayment({ payment_method: 'cod' })).toBe('cod');
    // WooCommerce stamps date_paid on COD orders moving to processing.
    expect(
      classifyWooCommercePayment({
        payment_method: ' COD ',
        date_paid: '2026-10-21T10:00:00',
      }),
    ).toBe('cod');
  });

  it('treats an online gateway with date_paid as prepaid', () => {
    expect(
      classifyWooCommercePayment({
        payment_method: 'razorpay',
        date_paid: '2026-10-21T10:00:00',
      }),
    ).toBe('prepaid');
  });

  it('accepts date_paid_gmt or transaction_id as payment evidence', () => {
    expect(
      classifyWooCommercePayment({
        payment_method: 'stripe',
        date_paid: null,
        date_paid_gmt: '2026-10-21T04:30:00',
      }),
    ).toBe('prepaid');
    expect(
      classifyWooCommercePayment({
        payment_method: 'ppcp-gateway',
        date_paid: null,
        transaction_id: 'TXN-123',
      }),
    ).toBe('prepaid');
  });

  it('does not treat an unpaid online order as prepaid', () => {
    expect(
      classifyWooCommercePayment({
        payment_method: 'razorpay',
        date_paid: null,
        transaction_id: '',
      }),
    ).toBe('unpaid_online');
  });

  it('keeps bank transfer and cheque out of both COD and prepaid', () => {
    expect(
      classifyWooCommercePayment({
        payment_method: 'bacs',
        date_paid: '2026-10-21T10:00:00',
      }),
    ).toBe('offline');
    expect(classifyWooCommercePayment({ payment_method: 'cheque' })).toBe('offline');
  });

  it('returns unknown when the order has no gateway', () => {
    expect(classifyWooCommercePayment({})).toBe('unknown');
    expect(classifyWooCommercePayment({ payment_method: '  ' })).toBe('unknown');
  });
});

describe('contextFromOrder payment fields', () => {
  const order: WooCommerceOrderPayload = {
    id: 42,
    number: '1042',
    status: 'processing',
    payment_method: 'cod',
    payment_method_title: 'Cash on delivery',
    billing: { phone: '+91 98765 43210' },
  };

  it('carries the stable gateway id, title, and payment type', () => {
    const ctx = contextFromOrder(order, 'https://shop.example.com');
    expect(ctx.paymentMethod).toBe('cod');
    expect(ctx.paymentMethodTitle).toBe('Cash on delivery');
    expect(ctx.paymentType).toBe('cod');
    // Order status is unchanged under the legacy key.
    expect(ctx.paymentStatus).toBe('processing');
  });
});
