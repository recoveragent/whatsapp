import { describe, expect, it, vi } from 'vitest'

import {
  enrichCachedOrdersFromShopify,
  enrichOrdersFromLivePayloads,
  mergeInboxDisplayFields,
  orderPayloadNeedsDetail,
} from './enrich-inbox-orders'
import * as adminApi from './admin-api'
import type { ShopifyOrderPayload } from './types'
import type { ShopifyOrder } from '@/types'

vi.mock('./admin-api', () => ({
  fetchOrder: vi.fn(),
}))

describe('enrich-inbox-orders', () => {
  it('merges product title and shipping address from live payload', () => {
    const cached: ShopifyOrder = {
      id: 'db-1',
      account_id: 'acc',
      shopify_order_id: '123',
      order_number: '#1001',
      tags: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }

    const live: ShopifyOrderPayload = {
      id: 123,
      line_items: [{ name: 'Green Tea Pack', quantity: 1 }],
      shipping_address: {
        name: 'Thatea',
        address1: 'Oberoi staff gate',
        city: 'Gurgaon',
        province: 'Haryana',
        zip: '122001',
        country: 'India',
      },
    }

    expect(mergeInboxDisplayFields(cached, live)).toMatchObject({
      product_title: 'Green Tea Pack',
      shipping_address: expect.stringContaining('Gurgaon'),
      order_status: 'open',
    })
  })

  it('enriches cached rows keyed by shopify_order_id', () => {
    const cached: ShopifyOrder[] = [
      {
        id: 'db-1',
        account_id: 'acc',
        shopify_order_id: '999',
        order_number: '#999',
        tags: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]

    const live: ShopifyOrderPayload[] = [
      { id: 999, line_items: [{ title: 'Sample', quantity: 2 }] },
    ]

    expect(enrichOrdersFromLivePayloads(cached, live)[0].product_title).toBe(
      'Sample ×2',
    )
  })

  it('detects when a list payload needs a full order fetch', () => {
    expect(orderPayloadNeedsDetail({ id: 1 })).toBe(true)
    expect(
      orderPayloadNeedsDetail({
        id: 1,
        line_items: [{ name: 'Item', quantity: 1 }],
      }),
    ).toBe(false)
  })

  it('fetches cached orders by shopify_order_id when display fields are missing', async () => {
    vi.mocked(adminApi.fetchOrder).mockResolvedValue({
      id: 999,
      line_items: [{ name: 'Fetched Tea', quantity: 1 }],
      shipping_address: { city: 'Gurgaon' },
    })

    const cached: ShopifyOrder[] = [
      {
        id: 'db-1',
        account_id: 'acc',
        shopify_order_id: '999',
        order_number: '#999',
        tags: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]

    const result = await enrichCachedOrdersFromShopify(
      'acc',
      cached,
      async () => ({
        shopDomain: 'shop.myshopify.com',
        accessToken: 'token',
      }),
    )

    expect(adminApi.fetchOrder).toHaveBeenCalledWith(
      'shop.myshopify.com',
      'token',
      '999',
    )
    expect(result.orders[0].product_title).toBe('Fetched Tea')
    expect(result.orders[0].shipping_address).toContain('Gurgaon')
  })
})
