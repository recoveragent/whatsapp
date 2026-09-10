import { describe, expect, it } from 'vitest';

import {
  groupShopifyCatalogProducts,
  type ShopifyCatalogProduct,
} from './product-store';

function variant(
  overrides: Partial<ShopifyCatalogProduct> & {
    shopify_product_id: number;
    shopify_variant_id: number;
    title: string;
  },
): ShopifyCatalogProduct {
  return {
    id: String(overrides.shopify_variant_id),
    variant_title: null,
    price: '799.00',
    compare_at_price: null,
    currency: 'INR',
    image_url: null,
    inventory_quantity: 5,
    in_stock: true,
    ...overrides,
  };
}

describe('groupShopifyCatalogProducts', () => {
  it('groups variants under one product row', () => {
    const groups = groupShopifyCatalogProducts([
      variant({
        shopify_product_id: 10,
        shopify_variant_id: 1001,
        title: 'Baby Birth Frame',
        variant_title: 'Design 1',
      }),
      variant({
        shopify_product_id: 10,
        shopify_variant_id: 1002,
        title: 'Baby Birth Frame',
        variant_title: 'Design 2',
      }),
      variant({
        shopify_product_id: 20,
        shopify_variant_id: 2001,
        title: 'Acrylic Frame',
      }),
    ]);

    expect(groups).toHaveLength(2);
    const babyFrame = groups.find((group) => group.shopify_product_id === 10);
    const acrylicFrame = groups.find((group) => group.shopify_product_id === 20);
    expect(babyFrame?.variants).toHaveLength(2);
    expect(acrylicFrame?.title).toBe('Acrylic Frame');
  });
});
