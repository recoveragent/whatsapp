import { describe, expect, it } from 'vitest';

import {
  mapShopifyProductRow,
  mapShopifyProductRows,
  pickDefaultVariant,
} from './products-sync';
import type { ShopifyProductPayload } from './types';

describe('mapShopifyProductRows', () => {
  it('maps every variant on a product', () => {
    const rows = mapShopifyProductRows({
      accountId: 'acct-1',
      product: {
        id: 100,
        title: 'Baby Birth Frame',
        status: 'active',
        variants: [
          {
            id: 1001,
            title: 'Design 1 / A4 size (8x12 Inch)',
            price: '799.00',
            inventory_quantity: 4,
            inventory_management: 'shopify',
            available: true,
          },
          {
            id: 1002,
            title: 'Design 2 / A4 size (8x12 Inch)',
            price: '799.00',
            inventory_quantity: 2,
            inventory_management: 'shopify',
            available: true,
          },
        ],
      },
      currency: 'INR',
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.shopify_variant_id)).toEqual([1001, 1002]);
    expect(rows[1]?.variant_title).toBe('Design 2 / A4 size (8x12 Inch)');
  });
});

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
