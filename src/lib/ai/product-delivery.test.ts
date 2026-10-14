import { describe, expect, it } from 'vitest';
import {
  appendRecommendationText,
  buildRecommendationText,
  canDeliverProductCarousel,
} from './product-delivery';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';

const product: ShopifyCatalogProduct = {
  id: '1',
  shopify_product_id: 1,
  shopify_variant_id: 101,
  title: 'Blue hoodie',
  variant_title: 'Large',
  price: '999.00',
  currency: 'INR',
  image_url: 'https://cdn.test/hoodie.jpg',
  in_stock: true,
  inventory_quantity: 5,
  compare_at_price: null,
};
const store = { shopDomain: 'gifts.myshopify.com', carouselEnabled: true };

describe('catalog recommendation delivery', () => {
  it('delivers a single match as grounded text with its exact variant link', () => {
    const text = appendRecommendationText('Here is a match.', [product], store);
    expect(text).toContain('Blue hoodie (Large)');
    expect(text).toContain('INR 999.00');
    expect(text).toContain('https://gifts.myshopify.com/cart/101:1');
    expect(canDeliverProductCarousel([product], store)).toBe(false);
  });
  it('selects text when an image is absent or carousels are disabled', () => {
    expect(
      canDeliverProductCarousel(
        [product, { ...product, image_url: null }],
        store
      )
    ).toBe(false);
    expect(
      canDeliverProductCarousel([product, product], {
        ...store,
        carouselEnabled: false,
      })
    ).toBe(false);
    expect(
      buildRecommendationText([{ ...product, image_url: null }], store)
    ).toContain('/cart/101:1');
    expect(
      buildRecommendationText([product], { ...store, carouselEnabled: false })
    ).not.toContain('/cart/');
  });
  it('never derives checkout links from an untrusted host or malformed variant id', () => {
    expect(
      buildRecommendationText([product], {
        ...store,
        shopDomain: 'store.myshopify.com@evil.test',
      })
    ).toBe('');
    expect(
      buildRecommendationText(
        [{ ...product, shopify_variant_id: Number.NaN }],
        store
      )
    ).toBe('');
  });
  it('keeps product details inside the WhatsApp text body limit', () => {
    const text = appendRecommendationText(
      'x'.repeat(5000),
      [product, product, product, product],
      store
    );
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('/cart/101:1');
  });
});
