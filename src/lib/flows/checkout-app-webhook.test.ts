import { describe, expect, it } from 'vitest'

import { enrichCheckoutAppWebhookVars } from './checkout-app-webhook'

describe('enrichCheckoutAppWebhookVars', () => {
  it('fills vars from common checkout-app payload shapes', () => {
    const payload = {
      phone: '+919876543210',
      name: 'Aditi Sharma',
      checkout_url: 'https://store.example.com/cart/recover/abc',
      cart_id: 'cart-99',
      total_price: 1299,
      line_items: [{ name: 'Running Shoes', quantity: 1, image_url: 'https://cdn/shoe.webp' }],
    }

    const vars = enrichCheckoutAppWebhookVars(payload, {})
    expect(vars.customer_name).toBe('Aditi Sharma')
    expect(vars.checkout_url).toBe('https://store.example.com/cart/recover/abc')
    expect(vars.checkout_url_suffix).toBe('cart/recover/abc')
    expect(vars.checkout_id).toBe('cart-99')
    expect(vars.order_items).toBe('Running Shoes')
    expect(vars.product_image).toBe('https://cdn/shoe.webp')
    expect(vars.phone).toBe('+919876543210')
  })

  it('reads GoKwik-style items.0.image', () => {
    const vars = enrichCheckoutAppWebhookVars(
      {
        items: [{ image: 'https://cdn.shopify.com/boxer.jpg', title: 'Boxer XL' }],
      },
      {},
    )
    expect(vars.product_image).toBe('https://cdn.shopify.com/boxer.jpg')
  })

  it('reads customer lastname and landing page from GoKwik raw', () => {
    const vars = enrichCheckoutAppWebhookVars(
      {
        customer: { lastname: 'Singh', firstname: 'Gurpreet' },
        landing_page: '/products/mens-cotton-boxer',
      },
      {},
    )
    expect(vars.customer_lastname).toBe('Singh')
    expect(vars.lastname).toBe('Singh')
    expect(vars.landing_page).toBe('/products/mens-cotton-boxer')
  })

  it('does not overwrite mapped vars', () => {
    const vars = enrichCheckoutAppWebhookVars(
      { checkout_url: 'https://ignored.example' },
      { checkout_url: 'https://kept.example' },
    )
    expect(vars.checkout_url).toBe('https://kept.example')
  })

  it('preserves structured checkout conditions without assuming cart tokens are order IDs', () => {
    const vars = enrichCheckoutAppWebhookVars({ data: {
      cart_id: 'cart-token', total_price: '2500.50', currency: 'INR',
      customer: { id: '123' }, shipping_address: { city: 'Mumbai', zip: '400001' },
      line_items: [{ product_id: '1', variant_id: '2', sku: 'SKU-A', quantity: 3 }],
      discount_codes: ['WELCOME'], total_discounts: '100.00',
    } }, {})
    expect(vars.shopify_condition_data).toMatchObject({ resource_type: 'checkout', total: 2500.5, currency: 'INR', product_ids: ['1'], variant_ids: ['2'], skus: ['SKU-A'], quantity: 3, discount_codes: ['WELCOME'], discount_total: 100, shipping_address: { city: 'Mumbai', zip: '400001' }, customer_id: '123' })
    expect(vars.shopify_order_id).toBeUndefined()
  })

  it('does not invent quantities, currency or addresses for incomplete provider events', () => {
    const vars = enrichCheckoutAppWebhookVars({ amount: 100, product: 'A product', items: [{ title: 'A product' }] }, {})
    expect(vars.shopify_condition_data).toMatchObject({ resource_type: 'checkout', total: 100 })
    const data = vars.shopify_condition_data as Record<string, unknown>
    expect(data.quantity).toBeUndefined()
    expect(data.currency).toBeUndefined()
    expect(data.has_shipping_address).toBeUndefined()
  })
})
