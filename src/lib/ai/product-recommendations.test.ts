import { describe, it, expect } from 'vitest'

import {
  buildProductSearchQuery,
  extractProductHintsFromKnowledge,
  extractProductSearchTerms,
  extractVariantIdsFromKnowledge,
  formatProductRecommendationsForAi,
  isProductRecommendationQuery,
  shouldOfferProductCarousel,
} from './product-recommendations'
import type { ChatMessage } from './types'
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store'

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
}

describe('isProductRecommendationQuery', () => {
  it('matches product browse intents', () => {
    expect(isProductRecommendationQuery('show me your products')).toBe(true)
    expect(isProductRecommendationQuery('can you recommend something?')).toBe(true)
    expect(isProductRecommendationQuery('I want to buy a hoodie')).toBe(true)
  })

  it('does not match unrelated support asks', () => {
    expect(isProductRecommendationQuery('where is my order?')).toBe(false)
    expect(isProductRecommendationQuery('cancel my order')).toBe(false)
  })
})

describe('extractProductSearchTerms', () => {
  it('removes filler words and keeps gift context', () => {
    expect(extractProductSearchTerms('show me products for anniversary gift')).toEqual([
      'anniversary',
      'gift',
    ])
  })
})

describe('buildProductSearchQuery', () => {
  it('combines terms from earlier turns in the thread', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to buy anniversary gift?' },
      { role: 'assistant', content: 'Who is it for?' },
      { role: 'user', content: 'wife' },
      { role: 'assistant', content: 'What budget?' },
      { role: 'user', content: 'show me products' },
    ]
    expect(buildProductSearchQuery(messages)).toBe('anniversary gift wife')
  })
})

describe('shouldOfferProductCarousel', () => {
  it('keeps carousel active on short follow-ups after a browse ask', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to buy anniversary gift?' },
      { role: 'assistant', content: 'Who is it for?' },
      { role: 'user', content: 'show me' },
    ]
    expect(shouldOfferProductCarousel(messages)).toBe(true)
  })
})

describe('extractVariantIdsFromKnowledge', () => {
  it('pulls variant ids from Shopify product URLs in a curation doc', () => {
    const ids = extractVariantIdsFromKnowledge([
      'Recommend ONLY:\n' +
        'https://giftingstudio.in/products/babybirthframelive?variant=45394003099873\n' +
        'https://giftingstudio.in/products/babybirthframelive?variant=45394003034337',
    ])
    expect(ids).toEqual([45394003099873, 45394003034337])
  })
})

describe('extractProductHintsFromKnowledge', () => {
  it('pulls bullet product names from a curation doc', () => {
    const hints = extractProductHintsFromKnowledge([
      'Baby birth frame — recommend these designs only:\n' +
        '- Baby Birth Frame - Classic Gold\n' +
        '- Baby Birth Frame - Floral Pink\n' +
        '- Baby Birth Frame - Starry Night\n' +
        'Never suggest items outside this list.',
    ])
    expect(hints).toEqual([
      'Baby Birth Frame - Classic Gold',
      'Baby Birth Frame - Floral Pink',
      'Baby Birth Frame - Starry Night',
    ])
  })
})

describe('aiProductCarouselLimit', () => {
  it('defaults to 4 products max', async () => {
    const { aiProductCarouselLimit } = await import('./product-recommendations')
    expect(aiProductCarouselLimit()).toBe(4)
  })
})

describe('formatProductRecommendationsForAi', () => {
  it('formats catalog rows for the system prompt', () => {
    const text = formatProductRecommendationsForAi([SAMPLE_PRODUCT])
    expect(text).toContain('Blue T-Shirt (Large)')
    expect(text).toContain('₹999.00')
  })
})
