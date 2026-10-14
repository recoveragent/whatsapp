import { describe, expect, it } from 'vitest';
import {
  extractProductPreferences,
  productMatchesPreferences,
  stripProductPreferenceTerms,
} from './product-preferences';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';

const product: ShopifyCatalogProduct = {
  id: '1',
  shopify_product_id: 1,
  shopify_variant_id: 101,
  title: 'Hoodie',
  variant_title: 'Red / Large',
  price: '1000.00',
  currency: 'INR',
  image_url: null,
  in_stock: true,
  inventory_quantity: 5,
  compare_at_price: null,
};
const prefs = (content: string) =>
  extractProductPreferences([{ role: 'user', content }]);

describe('guided selling constraints', () => {
  it.each([
    [
      'show me gifts under ₹1,500',
      { maxPrice: 1500, maxExclusive: true, currency: 'INR' },
    ],
    ['budget INR 1.5k', { maxPrice: 1500, currency: 'INR' }],
    [
      'between 500 and 1000 INR',
      { minPrice: 500, maxPrice: 1000, currency: 'INR' },
    ],
    [
      'over ₹500 and under ₹1000',
      {
        minPrice: 500,
        maxPrice: 1000,
        minExclusive: true,
        maxExclusive: true,
        currency: 'INR',
      },
    ],
    ['at most 50 EUR', { maxPrice: 50, maxExclusive: false, currency: 'EUR' }],
    ['under JPY 5000', { maxPrice: 5000, currency: 'JPY' }],
  ])('parses %s', (content, expected) => {
    expect(prefs(content)).toMatchObject(expected);
  });

  it('does not turn a product number into a budget', () => {
    expect(prefs('Show me the 1984 edition')).toEqual({});
    expect(prefs('1984')).toEqual({});
    expect(stripProductPreferenceTerms('1984')).toBe('1984');
  });
  it('does not mistake ordinary words after a bare amount for currency codes', () => {
    expect(prefs('under 1000 all colors').currency).toBeUndefined();
    expect(
      productMatchesPreferences(product, prefs('up to 1000 all colors'))
    ).toBe(true);
  });
  it('keeps budget and size through follow-ups and accepts a revised budget', () => {
    expect(
      extractProductPreferences([
        { role: 'user', content: 'Show hoodies under INR 500 in size XL' },
        { role: 'assistant', content: 'Any other preferences?' },
        { role: 'user', content: 'Actually up to INR 1500' },
      ])
    ).toMatchObject({
      maxPrice: 1500,
      maxExclusive: false,
      currency: 'INR',
      size: 'xl',
    });
  });
  it('keeps explicit currency when the customer revises only the amount', () => {
    expect(
      extractProductPreferences([
        { role: 'user', content: 'Show gifts under CAD 50' },
        { role: 'user', content: 'Actually up to 75' },
      ])
    ).toMatchObject({ maxPrice: 75, currency: 'CAD' });
  });
  it('uses a numeric follow-up only when the assistant asked for a budget', () => {
    expect(
      extractProductPreferences([
        { role: 'user', content: 'Recommend a hoodie' },
        { role: 'assistant', content: 'What is your budget?' },
        { role: 'user', content: '1500' },
      ])
    ).toMatchObject({ maxPrice: 1500 });
  });
  it('does not carry stale preferences across a support conversation', () => {
    expect(
      extractProductPreferences([
        { role: 'user', content: 'Show hoodies under INR 500 in size XL' },
        { role: 'user', content: 'Where is my order?' },
        { role: 'user', content: 'Show me gifts' },
      ])
    ).toEqual({});
  });
  it('retains constraints across longer shopping threads within the context window', () => {
    expect(
      extractProductPreferences([
        { role: 'user', content: 'Show hoodies under INR 1000 size L' },
        ...Array.from({ length: 6 }, () => ({
          role: 'user' as const,
          content: 'Something else please',
        })),
      ])
    ).toMatchObject({ maxPrice: 1000, currency: 'INR', size: 'l' });
  });
  it('requests clarification for ambiguous dollars and handles the answer', () => {
    expect(productMatchesPreferences(product, prefs('under $50'))).toBe(false);
    expect(productMatchesPreferences(product, prefs('under ₹50 USD'))).toBe(
      false
    );
    expect(
      extractProductPreferences([
        { role: 'user', content: 'Show me gifts under $50' },
        { role: 'assistant', content: 'Which currency?' },
        { role: 'user', content: 'CAD' },
      ])
    ).toMatchObject({
      maxPrice: 50,
      currency: 'CAD',
      ambiguousCurrency: false,
    });
  });
  it('compares numeric prices rather than sorting price text', () => {
    expect(productMatchesPreferences(product, prefs('under INR 900'))).toBe(
      false
    );
    expect(
      productMatchesPreferences(
        { ...product, price: '99.00' },
        prefs('under INR 900')
      )
    ).toBe(true);
  });
  it('enforces exclusive ceilings, floors and currency without conversion', () => {
    expect(productMatchesPreferences(product, prefs('under INR 1000'))).toBe(
      false
    );
    expect(productMatchesPreferences(product, prefs('up to INR 1000'))).toBe(
      true
    );
    expect(productMatchesPreferences(product, prefs('above INR 1000'))).toBe(
      false
    );
    expect(
      productMatchesPreferences(
        { ...product, currency: 'USD' },
        prefs('under INR 1500')
      )
    ).toBe(false);
    expect(
      productMatchesPreferences(product, prefs('between INR 1500 and INR 500'))
    ).toBe(false);
  });
  it('matches size aliases and rejects unsupported sizes instead of guessing', () => {
    expect(productMatchesPreferences(product, prefs('hoodie in size L'))).toBe(
      true
    );
    expect(productMatchesPreferences(product, prefs('hoodie in size XL'))).toBe(
      false
    );
    expect(
      productMatchesPreferences(
        { ...product, variant_title: 'XL / Blue' },
        prefs('size L')
      )
    ).toBe(false);
    expect(
      productMatchesPreferences(
        { ...product, variant_title: null },
        prefs('size L')
      )
    ).toBe(false);
  });
  it('does not round fractional sizes or mix size systems', () => {
    const fractional = { ...product, variant_title: '8.5 / Blue' };
    expect(productMatchesPreferences(fractional, prefs('size 8.5'))).toBe(true);
    expect(productMatchesPreferences(fractional, prefs('size 8'))).toBe(false);
    expect(
      productMatchesPreferences(
        { ...product, variant_title: 'UK 8 / Red' },
        prefs('size US 8')
      )
    ).toBe(false);
    expect(productMatchesPreferences(product, prefs('size enormous'))).toBe(
      false
    );
  });
  it('can explicitly remove a previous budget and size preference', () => {
    const result = extractProductPreferences([
      { role: 'user', content: 'Show hoodies under INR 500 size XL' },
      { role: 'user', content: 'No price limit, any size' },
    ]);
    expect(result).toEqual({});
  });
  it('rejects sold-out, invalid or unknown-currency budget results', () => {
    expect(productMatchesPreferences({ ...product, in_stock: false }, {})).toBe(
      false
    );
    expect(
      productMatchesPreferences({ ...product, price: 'unknown' }, {})
    ).toBe(false);
    expect(
      productMatchesPreferences(
        { ...product, currency: null },
        prefs('under 1500')
      )
    ).toBe(false);
  });
});
