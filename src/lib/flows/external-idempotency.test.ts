import { describe, expect, it } from 'vitest'

import { buildExternalIdempotencyKey } from './external-idempotency'
import type { FlowRow } from './types'

const flow = (trigger_type: string, id = 'flow-1'): FlowRow =>
  ({
    id,
    trigger_type,
  }) as FlowRow

describe('buildExternalIdempotencyKey', () => {
  it('builds shopify order placed key from order number', () => {
    expect(
      buildExternalIdempotencyKey(flow('shopify_order_placed'), {
        order_number: '#TTF9867',
      }),
    ).toBe('shopify:shopify_order_placed:#TTF9867')
  })

  it('includes shipment status for fulfillment triggers', () => {
    expect(
      buildExternalIdempotencyKey(flow('shopify_order_fulfilled'), {
        order_number: '#TTF9867',
        shipment_status: 'out_for_delivery',
      }),
    ).toBe('shopify:shopify_order_fulfilled:#TTF9867:out_for_delivery')
  })

  it('uses __none__ when fulfillment webhook omits shipment status', () => {
    expect(
      buildExternalIdempotencyKey(flow('shopify_order_fulfilled'), {
        order_number: '#TTF9867',
      }),
    ).toBe('shopify:shopify_order_fulfilled:#TTF9867:__none__')
  })

  it('returns null when order context is missing', () => {
    expect(buildExternalIdempotencyKey(flow('shopify_order_placed'), {})).toBeNull()
  })
})
