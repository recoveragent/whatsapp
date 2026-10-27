import { describe, expect, it } from 'vitest';
import {
  draftInputFor,
  quotePaise,
  recoveryCheckoutInput,
} from './recovery-checkout-input';
import { fastrrPayload } from './fastrr-checkout.fixture';

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
          title: 'Standard',
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
  it('carries Fastrr personalization onto the draft line item, including hidden fields', () => {
    const input = recoveryCheckoutInput(
      fastrrPayload({
        custom_attributes: {
          'Baby name': 'Test',
          Date: 11,
          _customization_id: 'test-customization',
          'Blood Group': null,
        },
      })
    );
    expect(input.draftInput.lineItems).toEqual([
      {
        variantId: 'gid://shopify/ProductVariant/45394003034337',
        quantity: 1,
        customAttributes: [
          { key: 'Baby name', value: 'Test' },
          { key: 'Date', value: '11' },
          { key: '_customization_id', value: 'test-customization' },
        ],
      },
    ]);
    expect(
      recoveryCheckoutInput(fastrrPayload({ custom_attributes: {} })).draftInput
        .lineItems
    ).toEqual([
      { variantId: 'gid://shopify/ProductVariant/45394003034337', quantity: 1 },
    ]);
  });
  it('carries Shopify properties sent as name/value pairs', () => {
    const p = checkoutPayload();
    expect(
      recoveryCheckoutInput({
        ...p,
        line_items: [
          {
            variant_id: 1234,
            quantity: 1,
            properties: [
              { name: 'Engraving', value: 'Asha' },
              { name: '', value: 'ignored' },
            ],
          },
        ],
      }).draftInput.lineItems
    ).toMatchObject([
      { customAttributes: [{ key: 'Engraving', value: 'Asha' }] },
    ]);
    expect(() =>
      recoveryCheckoutInput({
        ...p,
        line_items: [
          { variant_id: 1234, quantity: 1, properties: { Photo: { url: 'x' } } },
        ],
      })
    ).toThrow('unsupported personalization');
  });
  it('prices COD at the checkout partner COD total and prepaid at the checkout total', () => {
    // Real Gifting Studio orders: COD 1199 + "Standard (COD)" 100; prepaid 1199 + "Standard (Prepaid)" 0.
    const input = recoveryCheckoutInput(
      fastrrPayload({}, { cash_on_delivery_total_amount: 1299, discounted_amount: 1079 })
    );
    expect(input.codChargePaise).toBe(10000);
    expect(quotePaise(input, 'cod')).toBe(129900);
    expect(quotePaise(input, 'prepaid')).toBe(119900);
    expect(draftInputFor(input, 'cod').shippingLine).toEqual({
      title: 'Standard (COD)',
      priceWithCurrency: { amount: '100.00', currencyCode: 'INR' },
    });
    expect(draftInputFor(input, 'prepaid').shippingLine).toEqual({
      title: 'Standard (Prepaid)',
      priceWithCurrency: { amount: '0.00', currencyCode: 'INR' },
    });
  });
  it('charges no COD extra when the COD total is missing or below the checkout total', () => {
    for (const flat of [{}, { cash_on_delivery_total_amount: 'x' }, { cash_on_delivery_total_amount: 999 }]) {
      const input = recoveryCheckoutInput(fastrrPayload({}, flat));
      expect(quotePaise(input, 'cod')).toBe(119900);
    }
    // Native Shopify checkouts have no partner COD total.
    expect(recoveryCheckoutInput(checkoutPayload()).codChargePaise).toBe(0);
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
    { shipping_address: { city: 'Bengaluru' } },
  ])('refuses incomplete or unsupported checkout data: %j', (patch) => {
    expect(() =>
      recoveryCheckoutInput({ ...checkoutPayload(), ...patch })
    ).toThrow();
  });
});
