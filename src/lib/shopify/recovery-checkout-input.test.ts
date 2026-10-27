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

/** Shape of a Fastrr (Shiprocket) checkout mirrored by Recover Agent, with test details. */
export function fastrrPayload(item: Record<string, unknown> = {}) {
  const address = {
    zip: '560001',
    city: 'Bengaluru',
    name: 'Test Customer',
    phone: '9876543210',
    state: 'Karnataka',
    line_1: '12 Test Road',
    country: 'India',
    address1: '12 Test Road',
    last_name: 'Customer',
    first_name: 'Test',
    country_code: 'IN',
  };
  return {
    _wa_recover_agent_mirror: true,
    event: {
      event: 'abandoned_checkout',
      phone: '919876543210',
      amount: 1199,
      checkout_id: 'wh-test',
      raw: {
        tax: 0,
        email: 'test@example.com',
        items: [
          {
            sku: 'TEST-1',
            name: 'Photo frame',
            price: 1199,
            title: 'Photo frame',
            quantity: 1,
            product_id: 8596262879457,
            variant_id: 45394003034337,
            ...item,
          },
        ],
        currency: 'INR',
        source_name: 'fastrr',
        total_price: 1199,
        phone_number: '9876543210',
        discount_codes: [''],
        payment_status: 'Pending',
        shipping_price: 0,
        total_discount: 0,
        billing_address: address,
        shipping_address: address,
      },
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
  it('reads a Fastrr checkout with a top-level shipping_price', () => {
    expect(recoveryCheckoutInput(fastrrPayload())).toMatchObject({
      expectedPaise: 119900,
      phone: '919876543210',
      draftInput: {
        lineItems: [
          {
            variantId: 'gid://shopify/ProductVariant/45394003034337',
            quantity: 1,
          },
        ],
        shippingLine: {
          title: 'Shipping',
          priceWithCurrency: { amount: '0.00', currencyCode: 'INR' },
        },
        shippingAddress: {
          firstName: 'Test',
          province: 'Karnataka',
          zip: '560001',
          countryCode: 'IN',
        },
        discountCodes: [],
      },
    });
  });
  it('keeps Fastrr discount codes sent as plain strings', () => {
    const p = fastrrPayload();
    p.event.raw.discount_codes = ['SAVE10', ''];
    expect(recoveryCheckoutInput(p).draftInput.discountCodes).toEqual([
      'SAVE10',
    ]);
  });
  it('sends personalized Fastrr items to checkout instead of dropping the personalization', () => {
    expect(() =>
      recoveryCheckoutInput(
        fastrrPayload({
          custom_attributes: {
            'Baby name': 'Test',
            _customization_id: 'test-customization',
          },
        })
      )
    ).toThrow('Personalized items must be completed on the checkout page.');
    expect(() =>
      recoveryCheckoutInput(
        fastrrPayload({ custom_attributes: { _customization_id: 'hidden' } })
      )
    ).toThrow('Personalized');
    expect(() =>
      recoveryCheckoutInput(fastrrPayload({ custom_attributes: {} }))
    ).not.toThrow();
  });
  it('still refuses a Fastrr checkout with no shipping price', () => {
    const p = fastrrPayload();
    delete (p.event.raw as Record<string, unknown>).shipping_price;
    expect(() => recoveryCheckoutInput(p)).toThrow(
      'The selected shipping rate is missing.'
    );
  });
  it.each([
    { currency: 'USD' },
    { completed_at: '2026-10-26' },
    { order_id: 123 },
    { line_items: [{ title: 'Not a variant', quantity: 1 }] },
    { line_items: [{ variant_id: 1234, quantity: -1 }] },
    { shipping_lines: [] },
    { shipping_lines: [], shipping_price: 0 },
    { total_price: 'not-money' },
    { cod_charges: 20 },
    { gift_card_total: 10 },
    { subscription: true },
    { line_items: [{ variant_id: 1234, quantity: 1, properties: [{ name: 'Engraving', value: 'A' }] }] },
    { shipping_address: { city: 'Bengaluru' } },
  ])('refuses incomplete or unsupported checkout data: %j', (patch) => {
    expect(() =>
      recoveryCheckoutInput({ ...checkoutPayload(), ...patch })
    ).toThrow();
  });
});
