import { describe, expect, it } from 'vitest';

import {
  buildProductCardUrl,
  buildShopifyCartCheckoutUrl,
  buildShopifyProductPageUrl,
} from './product-checkout-url';

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

describe('buildShopifyProductPageUrl', () => {
  it('links the product page with the variant preselected', () => {
    expect(
      buildShopifyProductPageUrl({
        shopDomain: 'gifts.myshopify.com',
        handle: 'crystal-bracelet',
        variantId: 42,
      }),
    ).toBe(
      'https://gifts.myshopify.com/products/crystal-bracelet?variant=42&utm_source=whatsapp&utm_medium=wacrm',
    );
  });
});

describe('buildProductCardUrl', () => {
  const base = { shopDomain: 'gifts.myshopify.com', variantId: 42, quantity: 2 };

  it('defaults to the cart permalink', () => {
    expect(buildProductCardUrl({ ...base, handle: 'crystal-bracelet' })).toBe(
      'https://gifts.myshopify.com/cart/42:2',
    );
  });

  it('uses the product page when asked', () => {
    expect(
      buildProductCardUrl({ ...base, linkTarget: 'product_page', handle: 'crystal-bracelet' }),
    ).toMatch(/^https:\/\/gifts\.myshopify\.com\/products\/crystal-bracelet\?variant=42/);
  });

  it('falls back to the cart permalink without a handle', () => {
    expect(buildProductCardUrl({ ...base, linkTarget: 'product_page', handle: null })).toBe(
      'https://gifts.myshopify.com/cart/42:2',
    );
  });
});
