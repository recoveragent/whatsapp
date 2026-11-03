import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';

const mocks = vi.hoisted(() => ({ collections: vi.fn(), variants: vi.fn() }));
vi.mock('@/lib/shopify/collections', () => ({
  listShopifyCollections: mocks.collections,
  resolveCollectionCatalogVariants: mocks.variants,
}));
import {
  matchRequestedCollection,
  resolveRequestedCollection,
} from './product-recommendations';

const collections = [
  {
    id: 1,
    title: 'Baby Birth Frame',
    handle: 'baby-birth-frame',
    kind: 'custom' as const,
  },
  {
    id: 2,
    title: "Customized Women's Wallet",
    handle: 'customized-womens-wallet-leather',
    kind: 'custom' as const,
  },
];
const product = (
  id: number,
  price = '799',
  size = 'A4'
): ShopifyCatalogProduct => ({
  id: String(id),
  shopify_product_id: id,
  shopify_variant_id: id + 100,
  title: `Design ${id}`,
  variant_title: size,
  price,
  compare_at_price: null,
  currency: 'INR',
  image_url: 'https://example.com/image.jpg',
  inventory_quantity: 1,
  in_stock: true,
});
const db = {} as SupabaseClient;
beforeEach(() => {
  mocks.collections.mockReset().mockResolvedValue(collections);
  mocks.variants
    .mockReset()
    .mockResolvedValue([1, 2, 3, 4, 5, 6].map((id) => product(id)));
});

describe('collection recommendations', () => {
  it('matches a named collection rather than a loosely related title', () => {
    expect(
      matchRequestedCollection(
        'Show me the women’s wallet collection',
        collections
      )?.id
    ).toBe(2);
    expect(
      matchRequestedCollection('Show me the clock collection', collections)
    ).toBeNull();
    expect(
      matchRequestedCollection('Show me your collections', collections)
    ).toBeNull();
  });
  it('returns collection members and shows different items on more designs', async () => {
    const initial = await resolveRequestedCollection({
      db,
      accountId: 'a',
      preferences: {},
      messages: [
        { role: 'user', content: 'Show me your baby birth frame collection' },
      ],
    });
    expect(initial?.products.map((p) => p.shopify_variant_id)).toEqual([
      101, 102, 103, 104,
    ]);
    const more = await resolveRequestedCollection({
      db,
      accountId: 'a',
      preferences: {},
      messages: [
        { role: 'user', content: 'Show me your baby birth frame collection' },
        {
          role: 'assistant',
          content: 'Here they are',
          productVariantIds: [101, 102, 103, 104],
        },
        { role: 'user', content: 'Show me more designs' },
      ],
    });
    expect(more?.products.map((p) => p.shopify_variant_id)).toEqual([105, 106]);
    expect(mocks.variants).toHaveBeenCalledWith({
      db,
      accountId: 'a',
      collectionId: 1,
    });
  });
  it('filters budgets and size before choosing a variant per product', async () => {
    mocks.variants.mockResolvedValue([
      product(1, '1200', 'L'),
      product(2, '900', 'S'),
      product(2, '900', 'L'),
    ]);
    const result = await resolveRequestedCollection({
      db,
      accountId: 'a',
      preferences: { maxPrice: 1000, size: 'l' },
      messages: [
        {
          role: 'user',
          content:
            'Show me baby birth frame collection under INR 1000 in size L',
        },
      ],
    });
    expect(result?.products).toHaveLength(1);
    expect(result?.products[0].shopify_product_id).toBe(2);
  });
});
