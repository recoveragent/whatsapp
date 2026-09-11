import { describe, it, expect } from 'vitest'

import { buildPlaygroundProductCarousel } from './playground-carousel'
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store'

const PRODUCT: ShopifyCatalogProduct = {
  id: 'p1',
  shopify_product_id: 1,
  shopify_variant_id: 101,
  title: 'Blue Hoodie',
  variant_title: 'Medium',
  price: '1499.00',
  compare_at_price: null,
  currency: 'INR',
  image_url: 'https://cdn.example/hoodie.jpg',
  inventory_quantity: 3,
  in_stock: true,
}

describe('buildPlaygroundProductCarousel', () => {
  it('maps catalog products into a preview payload', () => {
    const preview = buildPlaygroundProductCarousel([PRODUCT, PRODUCT], true)
    expect(preview.products).toHaveLength(2)
    expect(preview.products[0].formatted_price).toBe('₹1499.00')
    expect(preview.live_ready).toBe(true)
  })
})
