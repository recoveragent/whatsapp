import { describe, expect, it } from 'vitest'

import { shopifyTopicToFlowTrigger } from './trigger-types'

describe('shopifyTopicToFlowTrigger', () => {
  it('maps orders/create → shopify_order_placed', () => {
    expect(shopifyTopicToFlowTrigger('orders/create')).toBe('shopify_order_placed')
  })

  it('maps orders/updated → shopify_order_updated', () => {
    expect(
      shopifyTopicToFlowTrigger('orders/updated', {
        cancelled_at: null,
        fulfillment_status: null,
      }),
    ).toBe('shopify_order_updated')
  })

  it('maps orders/updated with cancelled_at → shopify_order_cancelled', () => {
    expect(
      shopifyTopicToFlowTrigger('orders/updated', {
        cancelled_at: '2026-07-06T10:00:00Z',
      }),
    ).toBe('shopify_order_cancelled')
  })

  it('maps fulfillments/create with fulfilled order → shopify_order_fulfilled', () => {
    expect(
      shopifyTopicToFlowTrigger('fulfillments/create', {
        fulfillment_status: 'fulfilled',
      }),
    ).toBe('shopify_order_fulfilled')
  })

  it('maps fulfillments/create with partial fulfillment → shopify_order_partially_fulfilled', () => {
    expect(
      shopifyTopicToFlowTrigger('fulfillments/create', {
        fulfillment_status: 'partial',
      }),
    ).toBe('shopify_order_partially_fulfilled')
  })

  it('maps fulfillments/update the same as create', () => {
    expect(
      shopifyTopicToFlowTrigger('fulfillments/update', {
        fulfillment_status: 'fulfilled',
      }),
    ).toBe('shopify_order_fulfilled')
  })

  it('returns null for unrelated topics', () => {
    expect(shopifyTopicToFlowTrigger('checkouts/create')).toBeNull()
  })
})
