import { describe, expect, it } from 'vitest';

import { buildShopifyCartCheckoutUrl } from './product-checkout-url';

describe('buildShopifyCartCheckoutUrl', () => {
  it('builds a single-variant cart permalink', () => {
    expect(
      buildShopifyCartCheckoutUrl({
        shopDomain: 'demo.myshopify.com',
        variantId: 40123456789,
        quantity: 2,
      }),
    ).toBe('https://demo.myshopify.com/cart/40123456789:2');
  });

  it('defaults quantity to 1', () => {
    expect(
      buildShopifyCartCheckoutUrl({
        shopDomain: 'https://demo.myshopify.com/',
        variantId: '40123456789',
      }),
    ).toBe('https://demo.myshopify.com/cart/40123456789:1');
  });

  it('appends attribution attributes', () => {
    const url = buildShopifyCartCheckoutUrl({
      shopDomain: 'demo.myshopify.com',
      variantId: 40123456789,
      attributes: {
        source: 'wacrm',
        conversation_id: 'conv_123',
      },
    });

    expect(url).toContain('/cart/40123456789:1?');
    expect(url).toContain('attributes%5Bsource%5D=wacrm');
    expect(url).toContain('attributes%5Bconversation_id%5D=conv_123');
  });
});
