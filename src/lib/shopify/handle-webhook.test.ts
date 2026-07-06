import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { ShopifyFlowDispatchOutcome } from '@/lib/flows/shopify-dispatch'
import type { FlowTriggerType } from '@/lib/flows/trigger-types'
import type {
  ShopifyFulfillmentPayload,
  ShopifyOrderPayload,
} from './types'

const {
  syncShopifyOrder,
  loadCampaign,
  sendShopifyCampaign,
  dispatchShopifyFlows,
  fetchOrder,
} = vi.hoisted(() => ({
  syncShopifyOrder: vi.fn(),
  loadCampaign: vi.fn(),
  sendShopifyCampaign: vi.fn(),
  dispatchShopifyFlows: vi.fn(),
  fetchOrder: vi.fn(),
}))

vi.mock('./sync-order', () => ({ syncShopifyOrder }))
vi.mock('./send-campaign', () => ({ loadCampaign, sendShopifyCampaign }))
vi.mock('@/lib/flows/shopify-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flows/shopify-dispatch')>()
  return {
    ...actual,
    dispatchShopifyFlows,
  }
})
vi.mock('./admin-api', () => ({ fetchOrder }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn(() => 'test-token') }))

import { handleShopifyWebhook } from './handle-webhook'

const ACCOUNT_ID = 'acc-111'
const USER_ID = 'user-222'
const SHOP = 'demo-store.myshopify.com'

function mockDb(): SupabaseClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          account_id: ACCOUNT_ID,
          user_id: USER_ID,
          shop_domain: SHOP,
          access_token: 'enc',
          status: 'connected',
        },
        error: null,
      }),
    })),
  } as unknown as SupabaseClient
}

function baseOrder(overrides: Partial<ShopifyOrderPayload> = {}): ShopifyOrderPayload {
  return {
    id: 5678901234,
    name: '#GS191595',
    order_number: 191595,
    total_price: '1299.00',
    currency: 'INR',
    financial_status: 'pending',
    fulfillment_status: null,
    cancelled_at: null,
    customer: {
      first_name: 'Mohan',
      last_name: 'Kumar',
      phone: '+919788274333',
    },
    shipping_address: { phone: '+919788274333' },
    line_items: [{ name: 'Test product', quantity: 1 }],
    ...overrides,
  }
}

function dispatchOk(
  triggerType: FlowTriggerType,
): ShopifyFlowDispatchOutcome {
  return {
    ok: true,
    order_number: '#GS191595',
    payment_status: 'pending',
    dispatch: {
      started: [{ flow_id: 'flow-1', flow_name: 'Order confirmation', flow_run_id: 'run-1' }],
      skipped: [],
      no_active_flows: false,
    },
  }
}

describe('handleShopifyWebhook — Shopify → flow dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadCampaign.mockResolvedValue(null)
    sendShopifyCampaign.mockResolvedValue({ ok: true })
    syncShopifyOrder.mockResolvedValue(undefined)
    dispatchShopifyFlows.mockImplementation(async (args: { triggerType: FlowTriggerType }) =>
      dispatchOk(args.triggerType),
    )
  })

  it('orders/create: syncs order and dispatches shopify_order_placed', async () => {
    const order = baseOrder()
    const db = mockDb()

    await handleShopifyWebhook({
      db,
      shopDomain: SHOP,
      topic: 'orders/create',
      payload: order,
    })

    expect(syncShopifyOrder).toHaveBeenCalledWith(db, ACCOUNT_ID, order, 'demo-store')
    expect(dispatchShopifyFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        ownerUserId: USER_ID,
        triggerType: 'shopify_order_placed',
        context: expect.objectContaining({
          phone: '919788274333',
          orderNumber: '#GS191595',
          financialStatus: 'pending',
        }),
      }),
    )
  })

  it('orders/updated: dispatches shopify_order_updated for non-cancelled orders', async () => {
    const order = baseOrder({ financial_status: 'paid' })
    const db = mockDb()

    await handleShopifyWebhook({
      db,
      shopDomain: SHOP,
      topic: 'orders/updated',
      payload: order,
    })

    expect(dispatchShopifyFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'shopify_order_updated',
        context: expect.objectContaining({ financialStatus: 'paid' }),
      }),
    )
  })

  it('orders/updated: dispatches shopify_order_cancelled when cancelled_at is set', async () => {
    const order = baseOrder({
      cancelled_at: '2026-07-06T06:30:00Z',
      financial_status: 'voided',
    })
    const db = mockDb()

    await handleShopifyWebhook({
      db,
      shopDomain: SHOP,
      topic: 'orders/updated',
      payload: order,
    })

    expect(dispatchShopifyFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'shopify_order_cancelled',
      }),
    )
  })

  it('fulfillments/create: dispatches flows even when fulfillment campaign is disabled', async () => {
    const order = baseOrder({ fulfillment_status: 'fulfilled', financial_status: 'paid' })
    fetchOrder.mockResolvedValue(order)
    loadCampaign.mockResolvedValue(null)

    const fulfillment: ShopifyFulfillmentPayload = {
      id: 999,
      order_id: order.id,
      status: 'success',
      tracking_number: 'TRACK123',
      tracking_url: 'https://track.example/123',
    }
    const db = mockDb()

    await handleShopifyWebhook({
      db,
      shopDomain: SHOP,
      topic: 'fulfillments/create',
      payload: fulfillment,
    })

    expect(fetchOrder).toHaveBeenCalled()
    expect(sendShopifyCampaign).not.toHaveBeenCalled()
    expect(dispatchShopifyFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'shopify_order_fulfilled',
        context: expect.objectContaining({
          trackingNumber: 'TRACK123',
          phone: '919788274333',
        }),
      }),
    )
  })

  it('fulfillments/create with partial order: dispatches shopify_order_partially_fulfilled', async () => {
    const order = baseOrder({ fulfillment_status: 'partial' })
    fetchOrder.mockResolvedValue(order)
    const db = mockDb()

    await handleShopifyWebhook({
      db,
      shopDomain: SHOP,
      topic: 'fulfillments/create',
      payload: { id: 1, order_id: order.id, status: 'success' },
    })

    expect(dispatchShopifyFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'shopify_order_partially_fulfilled',
      }),
    )
  })

  it('orders/create without phone: still calls dispatch (dispatch layer returns no_phone)', async () => {
    const order = baseOrder({
      customer: { first_name: 'No', last_name: 'Phone' },
      shipping_address: undefined,
    })
    dispatchShopifyFlows.mockResolvedValue({
      ok: false,
      reason: 'no_phone',
      order_number: '#GS191595',
      payment_status: 'pending',
    })
    const db = mockDb()

    await handleShopifyWebhook({
      db,
      shopDomain: SHOP,
      topic: 'orders/create',
      payload: order,
    })

    expect(dispatchShopifyFlows).toHaveBeenCalled()
  })

  it('unknown shop: skips all dispatch', async () => {
    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    } as unknown as SupabaseClient

    await handleShopifyWebhook({
      db,
      shopDomain: 'missing.myshopify.com',
      topic: 'orders/create',
      payload: baseOrder(),
    })

    expect(dispatchShopifyFlows).not.toHaveBeenCalled()
  })
})
