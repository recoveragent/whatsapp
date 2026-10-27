import { describe, expect, it } from 'vitest';
import { recoveryCheckoutInput } from './recovery-checkout-input';

export function checkoutPayload() {
  return {
    id: '123',
    token: 'checkout-token',
    currency: 'INR',
    total_price: '250.00',
    phone: '+919876543210',
    line_items: [{ variant_id: 1234, quantity: 2 }],
    shipping_lines: [{ title: 'Standard', price: '50.00' }],
    shipping_address: {
      first_name: 'Test',
      last_name: 'Customer',
      address1: '12 Test Road',
      city: 'Bengaluru',
      province: 'Karnataka',
      zip: '560001',
      country_code: 'IN',
      phone: '+919876543210',
    },
  };
}

describe('recovery checkout input', () => {
  it('uses variant IDs and quantities, with a selected shipping rate', () => {
    expect(recoveryCheckoutInput(checkoutPayload())).toMatchObject({
      expectedPaise: 25000,
      draftInput: {
        lineItems: [
          { variantId: 'gid://shopify/ProductVariant/1234', quantity: 2 },
        ],
        shippingLine: {
          priceWithCurrency: { amount: '50.00', currencyCode: 'INR' },
        },
        shippingAddress: { countryCode: 'IN' },
      },
    });
  });
  it('normalizes a Recover Agent / GoKwik payload without accepting display product text as an item', () => {
    const p = checkoutPayload();
    expect(
      recoveryCheckoutInput({
        _wa_recover_agent_mirror: true,
        event: {
          amount: 250,
          phone: p.phone,
          product: 'Display only',
          raw: {
            currency: 'INR',
            items: p.line_items,
            shipping: { price: 50 },
            address: {
              firstname: 'Test',
              lastname: 'Customer',
              address: '12 Test Road',
              city: 'Bengaluru',
              state: 'Karnataka',
              pincode: '560001',
              country: 'India',
            },
          },
        },
      })
    ).toMatchObject({
      expectedPaise: 25000,
      draftInput: {
        lineItems: [
          { variantId: 'gid://shopify/ProductVariant/1234', quantity: 2 },
        ],
      },
    });
  });
  it.each([
    { currency: 'USD' },
    { completed_at: '2026-10-26' },
    { order_id: 123 },
    { line_items: [{ title: 'Not a variant', quantity: 1 }] },
    { line_items: [{ variant_id: 1234, quantity: -1 }] },
    { shipping_lines: [] },
    { total_price: 'not-money' },
    { cod_charges: 20 },
    { gift_card_total: 10 },
    { subscription: true },
    { shipping_address: { city: 'Bengaluru' } },
  ])('refuses incomplete or unsupported checkout data: %j', (patch) => {
    expect(() =>
      recoveryCheckoutInput({ ...checkoutPayload(), ...patch })
    ).toThrow();
  });
});
