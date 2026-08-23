import { describe, expect, it } from 'vitest'

import {
  contextFromOrder,
  firstProductIdFromLineItems,
  imageUrlFromLineItems,
} from './extract-context'
import { buildSendTimeParamsFromVariables } from '@/lib/flows/template-send-params'
import type { ShopifyOrderPayload } from './types'

describe('product image extraction', () => {
  it('reads image.src from line items when present', () => {
    expect(
      imageUrlFromLineItems([
        { title: 'Mug', image: { src: 'https://cdn.shopify.com/mug.jpg' } },
      ]),
    ).toBe('https://cdn.shopify.com/mug.jpg')
  })

  it('returns first product_id for Admin API lookup', () => {
    expect(
      firstProductIdFromLineItems([
        { title: 'Custom', quantity: 1 },
        { title: 'Mug', product_id: 998877 },
      ]),
    ).toBe('998877')
  })

  it('includes productImage on order context when line item has image', () => {
    const order: ShopifyOrderPayload = {
      id: 1,
      name: '#1001',
      line_items: [
        {
          name: 'Ceramic mug',
          quantity: 1,
          image: { src: 'https://cdn.shopify.com/mug.jpg' },
        },
      ],
      customer: { first_name: 'Ada', last_name: 'Lovelace' },
    }
    const ctx = contextFromOrder(order, 'demo')
    expect(ctx.productImage).toBe('https://cdn.shopify.com/mug.jpg')
  })
})

describe('header_media send params', () => {
  it('maps header_media through interpolation to headerMediaUrl', () => {
    const params = buildSendTimeParamsFromVariables(
      {
        '1': '{{ vars.customer_name }}',
        header_media: '{{ vars.product_image }}',
      },
      (raw) =>
        raw
          .replace('{{ vars.customer_name }}', 'Ada')
          .replace('{{ vars.product_image }}', 'https://cdn.shopify.com/mug.jpg'),
    )
    expect(params.body).toEqual(['Ada'])
    expect(params.headerMediaUrl).toBe('https://cdn.shopify.com/mug.jpg')
    expect(params.headerMediaRequired).toBe(true)
  })
})
