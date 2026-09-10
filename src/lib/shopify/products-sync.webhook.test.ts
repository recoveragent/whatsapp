import { describe, expect, it } from 'vitest';

import { mapShopifyProductRow, pickDefaultVariant } from './products-sync';
import type { ShopifyProductPayload } from './types';

describe('mapShopifyProductRow', () => {
  it('maps an active product to a catalog row', () => {
    const product: ShopifyProductPayload = {
      id: 100,
      title: 'Blue Widget',
      handle: 'blue-widget',
      status: 'active',
      image: { src: 'https://cdn.shopify.com/widget.jpg' },
      variants: [
        {
          id: 1001,
          title: 'Default',
          price: '499.00',
          inventory_quantity: 4,
          inventory_management: 'shopify',
          available: true,
        },
      ],
    };

    const row = mapShopifyProductRow({
      accountId: 'acct-1',
      product,
      currency: 'INR',
    });

    expect(row).toMatchObject({
      account_id: 'acct-1',
      shopify_product_id: 100,
      shopify_variant_id: 1001,
      title: 'Blue Widget',
      currency: 'INR',
      status: 'active',
    });
  });

  it('returns null when no variants exist', () => {
    const row = mapShopifyProductRow({
      accountId: 'acct-1',
      product: { id: 1, title: 'Empty', variants: [] },
      currency: null,
    });
    expect(row).toBeNull();
  });
});

describe('pickDefaultVariant', () => {
  it('skips out-of-stock variants when another is available', () => {
    const chosen = pickDefaultVariant([
      {
        id: 1,
        inventory_management: 'shopify',
        inventory_quantity: 0,
        available: true,
      },
      {
        id: 2,
        inventory_management: 'shopify',
        inventory_quantity: 3,
        available: true,
      },
    ]);
    expect(chosen?.id).toBe(2);
  });
});
