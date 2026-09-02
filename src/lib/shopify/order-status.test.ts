import { describe, expect, it } from 'vitest'

import {
  splitPublicUrlForWhatsApp,
  extractOrderStatusUrl,
  extractOrderTracking,
  deriveShopifyOrderStatus,
  formatShopifyOrderStatusLabel,
  formatShipmentStatusLabel,
} from './order-links'
import {
  buildTemplateParams,
  contextFromFulfillment,
  contextFromOrder,
} from './extract-context'
import type { ShopifyOrderPayload } from './types'

const STATUS_URL =
  'https://www.brand.com/690933842/orders/abc123/authenticate?key=secret'

describe('splitPublicUrlForWhatsApp', () => {
  it('splits origin (static) from path+query (suffix)', () => {
    expect(splitPublicUrlForWhatsApp(STATUS_URL)).toEqual({
      url: STATUS_URL,
      prefix: 'https://www.brand.com/',
      suffix: '690933842/orders/abc123/authenticate?key=secret',
    })
  })

  it('returns nulls for empty input', () => {
    expect(splitPublicUrlForWhatsApp(null)).toEqual({
      url: null,
      prefix: null,
      suffix: null,
    })
  })
})

describe('extractOrderTracking', () => {
  it('returns shipment_status from the fulfillment with tracking URL', () => {
    expect(
      extractOrderTracking({
        fulfillments: [
          {
            tracking_url: 'https://delhivery.com/track/tf4433',
            tracking_number: 'tf4433',
            shipment_status: 'In transit',
          },
        ],
      }),
    ).toEqual({
      tracking_url: 'https://delhivery.com/track/tf4433',
      tracking_number: 'tf4433',
      shipment_status: 'in_transit',
    })
  })

  it('formats shipment status labels for the inbox sidebar', () => {
    expect(formatShipmentStatusLabel('in_transit')).toBe('In transit')
    expect(formatShipmentStatusLabel('out_for_delivery')).toBe('Out for delivery')
    expect(formatShipmentStatusLabel('delivered')).toBe('Delivered')
    expect(formatShipmentStatusLabel(null)).toBeNull()
  })
})

describe('Shopify order lifecycle status', () => {
  it('derives cancelled when cancelled_at is set', () => {
    expect(
      deriveShopifyOrderStatus({ cancelled_at: '2026-07-06T06:30:00Z', closed_at: null }),
    ).toBe('cancelled')
  })

  it('derives archived when closed_at is set without cancellation', () => {
    expect(
      deriveShopifyOrderStatus({ cancelled_at: null, closed_at: '2026-07-06T06:30:00Z' }),
    ).toBe('archived')
  })

  it('derives open (active) for in-progress orders', () => {
    expect(deriveShopifyOrderStatus({ cancelled_at: null, closed_at: null })).toBe('open')
  })

  it('formats labels for the inbox sidebar', () => {
    expect(formatShopifyOrderStatusLabel('open')).toBe('Active')
    expect(formatShopifyOrderStatusLabel('cancelled')).toBe('Cancelled')
    expect(formatShopifyOrderStatusLabel('archived')).toBe('Archived')
    expect(formatShopifyOrderStatusLabel(null)).toBe('Active')
  })
})

describe('Shopify order status context', () => {
  it('exposes full URL and WhatsApp button suffix from the order', () => {
    const order: ShopifyOrderPayload = {
      id: 1,
      name: '#1001',
      order_status_url: STATUS_URL,
      customer: { first_name: 'Mohan' },
    }
    const ctx = contextFromOrder(order, 'brand')
    expect(ctx.orderStatusUrl).toBe(STATUS_URL)
    expect(ctx.orderStatusUrlSuffix).toBe(
      '690933842/orders/abc123/authenticate?key=secret',
    )
    expect(extractOrderStatusUrl(order)).toBe(STATUS_URL)
  })

  it('keeps order status from the fetched order on fulfillment (not courier URL)', () => {
    const order: ShopifyOrderPayload = {
      id: 1,
      name: '#1001',
      order_status_url: STATUS_URL,
      customer: { first_name: 'Mohan' },
    }
    const ctx = contextFromFulfillment(
      {
        id: 9,
        order_id: 1,
        tracking_url: 'https://delhivery.com/track/tf4433',
        tracking_number: 'tf4433',
        shipment_status: 'In transit',
      },
      order,
      'brand',
    )
    expect(ctx.trackingUrl).toBe('https://delhivery.com/track/tf4433')
    expect(ctx.shipmentStatus).toBe('in_transit')
    expect(ctx.orderStatusUrl).toBe(STATUS_URL)
    expect(ctx.orderStatusUrlSuffix).toBe(
      '690933842/orders/abc123/authenticate?key=secret',
    )
    expect(
      buildTemplateParams(
        { '1': 'order_status_url_suffix' },
        ctx,
      ),
    ).toEqual(['690933842/orders/abc123/authenticate?key=secret'])
  })
})
