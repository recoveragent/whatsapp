import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  card: vi.fn(),
  carousel: vi.fn(),
  collection: vi.fn(),
  catalog: new Map<string, { in_stock: boolean; image_url: string | null }>(),
}));

vi.mock('./send-product-card', () => ({ sendShopifyProductCard: h.card }));
vi.mock('./send-product-carousel', () => ({ sendShopifyProductCarousel: h.carousel }));
vi.mock('./collections', () => ({ resolveCollectionCatalogProducts: h.collection }));
vi.mock('./product-store', () => ({
  getShopifyCatalogProduct: async ({ shopifyVariantId }: { shopifyVariantId: string }) =>
    h.catalog.get(String(shopifyVariantId)) ?? null,
}));

import { resolveStaticSendProductVariantIds, sendProductNode } from './send-product-node';
import type { SendProductNodeConfig } from '@/lib/flows/types';

const base = {
  db: {} as never,
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  flowRunId: 'run-1',
  vars: {},
};

beforeEach(() => {
  h.card.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.card', checkout_url: 'https://x' });
  h.carousel.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.carousel' });
  h.collection.mockReset();
  h.catalog.clear();
});

describe('resolveStaticSendProductVariantIds', () => {
  it('prefers the products list over the legacy single id', () => {
    expect(
      resolveStaticSendProductVariantIds({
        cfg: {
          product_source: 'fixed',
          shopify_variant_id: '1',
          products: [{ shopify_variant_id: '2' }, { shopify_variant_id: 3 }, { shopify_variant_id: '2' }],
          next_node_key: 'n',
        },
        vars: {},
      }),
    ).toEqual(['2', '3']);
  });

  it('falls back to the legacy single id', () => {
    expect(
      resolveStaticSendProductVariantIds({
        cfg: { product_source: 'fixed', shopify_variant_id: 40, next_node_key: 'n' },
        vars: {},
      }),
    ).toEqual(['40']);
  });

  it('splits comma-separated and array variables', () => {
    const cfg: SendProductNodeConfig = { product_source: 'variable', variant_id_var: 'ids', next_node_key: 'n' };
    expect(resolveStaticSendProductVariantIds({ cfg, vars: { ids: '1, 2 ,3' } })).toEqual(['1', '2', '3']);
    expect(resolveStaticSendProductVariantIds({ cfg, vars: { ids: [4, 5] } })).toEqual(['4', '5']);
    expect(() => resolveStaticSendProductVariantIds({ cfg, vars: {} })).toThrow(/Missing flow var/);
  });
});

describe('sendProductNode', () => {
  it('sends a single card for one product', async () => {
    const result = await sendProductNode({
      ...base,
      cfg: { product_source: 'fixed', products: [{ shopify_variant_id: '1' }], next_node_key: 'n' },
      introText: 'Hi',
    });
    expect(result.mode).toBe('card');
    expect(h.card).toHaveBeenCalledWith(expect.objectContaining({ shopifyVariantId: '1', introText: 'Hi' }));
    expect(h.carousel).not.toHaveBeenCalled();
  });

  it('sends a carousel of usable products and a default intro', async () => {
    h.catalog.set('1', { in_stock: true, image_url: 'https://a' });
    h.catalog.set('2', { in_stock: true, image_url: null });
    h.catalog.set('3', { in_stock: true, image_url: 'https://c' });
    const result = await sendProductNode({
      ...base,
      cfg: {
        product_source: 'fixed',
        products: [{ shopify_variant_id: '1' }, { shopify_variant_id: '2' }, { shopify_variant_id: '3' }],
        quantity: 2,
        next_node_key: 'n',
      },
    });
    expect(result).toMatchObject({ mode: 'carousel', shopify_variant_ids: ['1', '3'] });
    expect(h.carousel).toHaveBeenCalledWith(
      expect.objectContaining({ shopifyVariantIds: ['1', '3'], quantity: 2, bodyText: expect.any(String) }),
    );
  });

  it('falls back to a single card when only one product can be shown', async () => {
    h.catalog.set('1', { in_stock: false, image_url: 'https://a' });
    h.catalog.set('2', { in_stock: true, image_url: null });
    const result = await sendProductNode({
      ...base,
      cfg: {
        product_source: 'fixed',
        products: [{ shopify_variant_id: '1' }, { shopify_variant_id: '2' }],
        next_node_key: 'n',
      },
    });
    expect(result.mode).toBe('card');
    expect(h.card).toHaveBeenCalledWith(expect.objectContaining({ shopifyVariantId: '2' }));
  });

  it('pulls collection products with the configured limit', async () => {
    h.collection.mockResolvedValue([
      { shopify_variant_id: 11 },
      { shopify_variant_id: 12 },
    ]);
    h.catalog.set('11', { in_stock: true, image_url: 'https://a' });
    h.catalog.set('12', { in_stock: true, image_url: 'https://b' });
    const result = await sendProductNode({
      ...base,
      cfg: { product_source: 'collection', collection_id: '99', max_products: 6, next_node_key: 'n' },
    });
    expect(h.collection).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: '99', limit: 6, requireImage: true }),
    );
    expect(result).toMatchObject({ mode: 'carousel', shopify_variant_ids: ['11', '12'] });
  });

  it('fails clearly when a collection has nothing to send', async () => {
    h.collection.mockResolvedValue([]);
    await expect(
      sendProductNode({
        ...base,
        cfg: { product_source: 'collection', collection_id: '99', collection_title: 'Gifts', next_node_key: 'n' },
      }),
    ).rejects.toThrow(/Gifts/);
  });
});
