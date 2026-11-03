import { describe, expect, it } from 'vitest';
import {
  extractProductPreferences,
  productMatchesPreferences,
  stripProductPreferenceTerms,
} from './product-preferences';
import { safeProductIntro } from './product-delivery';
import { parseGeneration } from './generate';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';

const product = (
  title: string,
  variant_title: string | null
): ShopifyCatalogProduct => ({
  id: '1',
  shopify_product_id: 1,
  shopify_variant_id: 1,
  title,
  variant_title,
  price: '999',
  compare_at_price: null,
  currency: 'INR',
  image_url: null,
  inventory_quantity: 1,
  in_stock: true,
});
describe('observed recommendation failures', () => {
  it('excludes explicitly rejected photo frames', () => {
    const text = 'Need an anniversary gift that is not a photo frame';
    const preferences = extractProductPreferences([
      { role: 'user', content: text },
    ]);
    expect(
      productMatchesPreferences(
        product('Personalized Baby Birth Photo Frame', null),
        preferences
      )
    ).toBe(false);
    expect(
      productMatchesPreferences(
        product('Personalized Night Lamp', null),
        preferences
      )
    ).toBe(true);
    expect(stripProductPreferenceTerms(text)).not.toContain('photo frame');
  });
  it('matches a requested 12 inch variant without accepting other dimensions', () => {
    const preferences = extractProductPreferences([
      { role: 'user', content: 'I want a photo wall clock in size 12 inches' },
    ]);
    expect(
      productMatchesPreferences(
        product('Photo Wall Clock', 'A1 / 12 Inches'),
        preferences
      )
    ).toBe(true);
    expect(
      productMatchesPreferences(
        product('Photo Wall Clock', 'A1 / 18 Inches'),
        preferences
      )
    ).toBe(false);
  });
  it('removes leaked malformed reply metadata', () => {
    expect(
      parseGeneration('Here are options. [[?]] No, quick replies needed.').text
    ).toBe('Here are options.');
  });
  it('replaces an intro that denies products while cards are present', () => {
    expect(
      safeProductIntro('I don’t have any additional designs to show here.')
    ).toBe('Here are some options you can explore.');
    expect(safeProductIntro('Here are some additional designs.')).toBe(
      'Here are some additional designs.'
    );
  });
});
