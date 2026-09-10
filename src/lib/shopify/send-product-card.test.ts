import { describe, expect, it } from 'vitest';

import {
  buildProductCardBodyText,
  formatShopifyProductPrice,
  resolveSendProductVariantId,
} from './send-product-card';

describe('formatShopifyProductPrice', () => {
  it('formats INR prices', () => {
    expect(formatShopifyProductPrice('499.00', 'INR')).toBe('₹499.00');
  });

  it('falls back to plain price', () => {
    expect(formatShopifyProductPrice('19.99', null)).toBe('19.99');
  });
});

describe('resolveSendProductVariantId', () => {
  it('reads a fixed variant id', () => {
    expect(
      resolveSendProductVariantId({
        cfg: {
          product_source: 'fixed',
          shopify_variant_id: '40123456789',
          next_node_key: 'next',
        },
        vars: {},
      }),
    ).toBe('40123456789');
  });

  it('reads a variable variant id from flow vars', () => {
    expect(
      resolveSendProductVariantId({
        cfg: {
          product_source: 'variable',
          variant_id_var: 'shopify_variant_id',
          next_node_key: 'next',
        },
        vars: { shopify_variant_id: 999 },
      }),
    ).toBe('999');
  });
});

describe('buildProductCardBodyText', () => {
  it('includes title and price', () => {
    expect(
      buildProductCardBodyText({
        title: 'Blue Widget',
        price: '499.00',
        currency: 'INR',
      }),
    ).toBe('Blue Widget\n₹499.00');
  });

  it('appends non-default variant title', () => {
    expect(
      buildProductCardBodyText({
        title: 'Blue Widget',
        price: '499.00',
        currency: 'INR',
        variantTitle: 'Large',
      }),
    ).toBe('Blue Widget (Large)\n₹499.00');
  });
});
