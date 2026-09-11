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
})
