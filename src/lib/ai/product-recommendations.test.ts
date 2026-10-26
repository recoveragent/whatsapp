import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/shopify/product-store', () => ({
  searchShopifyProducts: vi.fn(),
  getShopifyCatalogProduct: vi.fn(),
}));
import {
  searchShopifyProducts,
  getShopifyCatalogProduct,
} from '@/lib/shopify/product-store';

import {
  buildProductSearchQuery,
  extractProductHintsFromKnowledge,
  extractProductSearchTerms,
  extractVariantIdsFromKnowledge,
  formatProductRecommendationsForAi,
  isProductRecommendationQuery,
  shouldOfferProductCarousel,
  resolveRecommendedProducts,
  productMatchScore,
  weightedSearchTerms,
} from './product-recommendations';
import type { ChatMessage } from './types';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';

const SAMPLE_PRODUCT: ShopifyCatalogProduct = {
  id: 'p1',
  shopify_product_id: 1,
  shopify_variant_id: 101,
  title: 'Blue T-Shirt',
  variant_title: 'Large',
  price: '999.00',
  compare_at_price: null,
  currency: 'INR',
  image_url: 'https://cdn.example/shirt.jpg',
  inventory_quantity: 5,
  in_stock: true,
};

beforeEach(() => {
  vi.mocked(searchShopifyProducts).mockReset();
  vi.mocked(getShopifyCatalogProduct).mockReset();
});

describe('isProductRecommendationQuery', () => {
  it('matches product browse intents', () => {
    expect(isProductRecommendationQuery('show me your products')).toBe(true);
    expect(isProductRecommendationQuery('can you recommend something?')).toBe(
      true
    );
    expect(isProductRecommendationQuery('I want to buy a hoodie')).toBe(true);
  });

  it('does not match unrelated support asks', () => {
    expect(isProductRecommendationQuery('where is my order?')).toBe(false);
    expect(isProductRecommendationQuery('cancel my order')).toBe(false);
  });
});

describe('extractProductSearchTerms', () => {
  it('removes filler words and keeps gift context', () => {
    expect(
      extractProductSearchTerms('show me products for anniversary gift')
    ).toEqual(['anniversary', 'gift']);
  });
});

describe('buildProductSearchQuery', () => {
  it('searches product keywords without budget/size syntax', () => {
    expect(
      buildProductSearchQuery([
        { role: 'user', content: 'Show me hoodie under INR 1500 in size L' },
      ])
    ).toBe('hoodie');
  });
  it('starts a fresh search after support rather than mixing old gift terms', () => {
    expect(
      buildProductSearchQuery([
        { role: 'user', content: 'Recommend anniversary gift for wife' },
        { role: 'user', content: 'Cancel my order' },
        { role: 'user', content: 'Show me hoodies' },
      ])
    ).toBe('hoodies');
  });
  it('combines terms from earlier turns in the thread', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to buy anniversary gift?' },
      { role: 'assistant', content: 'Who is it for?' },
      { role: 'user', content: 'wife' },
      { role: 'assistant', content: 'What budget?' },
      { role: 'user', content: 'show me products' },
    ];
    expect(buildProductSearchQuery(messages)).toBe('anniversary gift wife');
  });
});

describe('shouldOfferProductCarousel', () => {
  it.each([
    'Where is my order?',
    'Cancel my order',
    'Return this product',
    'I want a human',
    'My gift arrived damaged',
    'What is the shipping policy?',
    'Do you have a size guide?',
  ])('stops browsing when the topic changes to %s', (content) => {
    expect(
      shouldOfferProductCarousel([
        { role: 'user', content: 'Recommend a birthday gift' },
        { role: 'assistant', content: 'What is your budget?' },
        { role: 'user', content },
      ])
    ).toBe(false);
  });
  it('does not revive old browsing after an order-support turn', () => {
    expect(
      shouldOfferProductCarousel([
        { role: 'user', content: 'Show me products' },
        { role: 'user', content: 'Where is my order?' },
        { role: 'assistant', content: 'Which order?' },
        { role: 'user', content: '#1042' },
      ])
    ).toBe(false);
  });
  it('keeps carousel active on short follow-ups after a browse ask', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to buy anniversary gift?' },
      { role: 'assistant', content: 'Who is it for?' },
      { role: 'user', content: 'show me' },
    ];
    expect(shouldOfferProductCarousel(messages)).toBe(true);
  });
});

describe('constraint-aware catalog resolution', () => {
  it('filters before limiting so cheaper later candidates are retained', async () => {
    vi.mocked(searchShopifyProducts).mockResolvedValue([
      ...Array.from({ length: 4 }, (_, i) => ({
        ...SAMPLE_PRODUCT,
        shopify_variant_id: 100 + i,
        price: '2000',
      })),
      {
        ...SAMPLE_PRODUCT,
        shopify_variant_id: 200,
        title: 'Hoodie',
        price: '500',
        image_url: null,
      },
    ]);
    const result = await resolveRecommendedProducts(
      {} as never,
      'acct-1',
      'hoodie',
      [],
      4,
      { maxPrice: 1000, currency: 'INR' }
    );
    expect(result.map((product) => product.shopify_variant_id)).toEqual([200]);
  });
  it('applies constraints to merchant-curated variants too', async () => {
    vi.mocked(getShopifyCatalogProduct).mockImplementation(
      async ({ shopifyVariantId }) => ({
        ...SAMPLE_PRODUCT,
        shopify_variant_id: Number(shopifyVariantId),
        price: Number(shopifyVariantId) === 101 ? '2000' : '500',
      })
    );
    const result = await resolveRecommendedProducts(
      {} as never,
      'acct-1',
      'hoodie',
      ['https://store.test/p?variant=101 https://store.test/p?variant=102'],
      4,
      { maxPrice: 1000, currency: 'INR' }
    );
    expect(result.map((product) => product.shopify_variant_id)).toEqual([102]);
    expect(searchShopifyProducts).not.toHaveBeenCalled();
  });
  it('does not substitute an unrelated catalog item when curated choices fail constraints', async () => {
    vi.mocked(getShopifyCatalogProduct).mockResolvedValue(SAMPLE_PRODUCT);
    const result = await resolveRecommendedProducts(
      {} as never,
      'acct-1',
      'hoodie',
      ['https://store.test/p?variant=101'],
      4,
      { size: 'xl' }
    );
    expect(result).toEqual([]);
    expect(searchShopifyProducts).not.toHaveBeenCalled();
  });
});

describe('extractVariantIdsFromKnowledge', () => {
  it('pulls variant ids from Shopify product URLs in a curation doc', () => {
    const ids = extractVariantIdsFromKnowledge([
      'Recommend ONLY:\n' +
        'https://giftingstudio.in/products/babybirthframelive?variant=45394003099873\n' +
        'https://giftingstudio.in/products/babybirthframelive?variant=45394003034337',
    ]);
    expect(ids).toEqual([45394003099873, 45394003034337]);
  });
});

describe('extractProductHintsFromKnowledge', () => {
  it('pulls bullet product names from a curation doc', () => {
    const hints = extractProductHintsFromKnowledge([
      'Baby birth frame — recommend these designs only:\n' +
        '- Baby Birth Frame - Classic Gold\n' +
        '- Baby Birth Frame - Floral Pink\n' +
        '- Baby Birth Frame - Starry Night\n' +
        'Never suggest items outside this list.',
    ]);
    expect(hints).toEqual([
      'Baby Birth Frame - Classic Gold',
      'Baby Birth Frame - Floral Pink',
      'Baby Birth Frame - Starry Night',
    ]);
  });
});

describe('aiProductCarouselLimit', () => {
  it('defaults to 4 products max', async () => {
    const { aiProductCarouselLimit } =
      await import('./product-recommendations');
    expect(aiProductCarouselLimit()).toBe(4);
  });
});

describe('formatProductRecommendationsForAi', () => {
  it('formats catalog rows for the system prompt', () => {
    const text = formatProductRecommendationsForAi([SAMPLE_PRODUCT]);
    expect(text).toContain('Blue T-Shirt (Large)');
    expect(text).toContain('₹999.00');
  });
});

describe('ranked catalog search', () => {
  const row = (
    productId: number,
    variantId: number,
    title: string,
    price = '999'
  ): ShopifyCatalogProduct => ({
    ...SAMPLE_PRODUCT,
    shopify_product_id: productId,
    shopify_variant_id: variantId,
    title,
    variant_title: null,
    price,
  });

  it('ranks by fit, maps recipients to catalog words and shows one variant per product', async () => {
    const catalog = [
      row(1, 11, 'Wooden photo Standy - Gift for all occasions', '690'),
      row(1, 12, 'Wooden photo Standy - Gift for all occasions', '990'),
      row(2, 21, "Customized Men's Wallet and Pen Combo"),
      row(5, 51, "Customized Men's Wallet and Pen Combo - Olive Green"),
      row(3, 31, "Customized Women's Wallet"),
      row(4, 41, 'Personalised Magic Mug', '550'),
    ];
    vi.mocked(searchShopifyProducts).mockImplementation(async ({ query }) =>
      catalog.filter((p) => p.title.toLowerCase().includes(String(query)))
    );
    const result = await resolveRecommendedProducts(
      {} as never,
      'acct-1',
      'gift dad',
      [],
      4
    );
    expect(result.map((p) => p.shopify_variant_id)).toEqual([21]);
  });

  it('does not treat "women" as a match for "men"', () => {
    const weighted = weightedSearchTerms(['dad']);
    expect(
      productMatchScore(row(3, 31, "Customized Women's Wallet"), weighted)
    ).toBe(0);
    expect(
      productMatchScore(row(2, 21, "Customized Men's Wallet"), weighted)
    ).toBe(0.75);
  });
});
