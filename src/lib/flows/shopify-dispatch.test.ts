import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ensureShopifyContact,
  ensureConversation,
  deleteConversationIfEmpty,
  runFlowsForTrigger,
  hasActiveFlowsForTrigger,
} = vi.hoisted(() => ({
  ensureShopifyContact: vi.fn(),
  ensureConversation: vi.fn(),
  deleteConversationIfEmpty: vi.fn(),
  runFlowsForTrigger: vi.fn(),
  hasActiveFlowsForTrigger: vi.fn(),
}))

vi.mock('@/lib/shopify/ensure-contact', () => ({
  ensureShopifyContact,
  ensureConversation,
  deleteConversationIfEmpty,
}))

vi.mock('./dispatch-external', () => ({ runFlowsForTrigger, hasActiveFlowsForTrigger }))

import type { ShopifyEventContext } from '@/lib/shopify/types'

import { dispatchShopifyFlows } from './shopify-dispatch'

const baseContext: ShopifyEventContext = {
  resourceKey: 'order:123',
  phone: '919591141699',
  customerName: 'Jagadish',
  email: null,
  orderNumber: '#TTF10017',
  orderTotal: '599.00 INR',
  orderItems: null,
  productImage: null,
  shippingAddress: null,
  shippingAddressFields: null,
  trackingNumber: null,
  trackingUrl: null,
  orderStatusUrl: null,
  orderStatusUrlSuffix: null,
  trackingRedirectSuffix: null,
  checkoutUrl: null,
  checkoutUrlSuffix: null,
  fulfillmentStatus: null,
  shipmentStatus: null,
  financialStatus: 'paid',
  shopName: 'test-shop',
}

describe('dispatchShopifyFlows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureShopifyContact.mockResolvedValue({
      id: 'contact-1',
      phone: '919591141699',
    })
    ensureConversation.mockResolvedValue({ id: 'conv-1', created: true })
    hasActiveFlowsForTrigger.mockResolvedValue(true)
  })

  it('passes structured data and the order identity through fulfillment dispatch', async () => {
    runFlowsForTrigger.mockResolvedValue({ started: [], skipped: [], no_active_flows: true })
    await dispatchShopifyFlows({ db: {} as never, accountId: 'acc-1', ownerUserId: 'user-1', triggerType: 'shopify_order_fulfilled', context: { ...baseContext, resourceKey: 'fulfillment:900', shopifyOrderId: '123', conditionData: { resource_type: 'order', total: 599 } } })
    expect(runFlowsForTrigger).toHaveBeenCalledWith(expect.objectContaining({ context: { vars: expect.objectContaining({ shopify_order_id: '123', shopify_condition_data: { resource_type: 'order', total: 599 } }) } }))
  })

  it('attempts empty-shell cleanup for a conversation it created (active runs guarded inside helper)', async () => {
    runFlowsForTrigger.mockResolvedValue({
      started: [],
      skipped: [
        {
          flow_id: 'flow-1',
          flow_name: 'Prepaid order placed',
          reason: 'start_failed',
        },
      ],
      no_active_flows: false,
    })

    await dispatchShopifyFlows({
      db: {} as never,
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      triggerType: 'shopify_order_placed',
      context: baseContext,
    })

    expect(deleteConversationIfEmpty).toHaveBeenCalledWith(
      {},
      'conv-1',
      { accountId: 'acc-1', contactId: 'contact-1' },
    )
  })

  it('cleans up empty shell when dispatch did not defer to an active run', async () => {
    runFlowsForTrigger.mockResolvedValue({
      started: [],
      skipped: [
        {
          flow_id: 'flow-1',
          flow_name: 'COD order placed',
          reason: 'payment_status_mismatch',
        },
      ],
      no_active_flows: false,
    })

    await dispatchShopifyFlows({
      db: {} as never,
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      triggerType: 'shopify_order_placed',
      context: baseContext,
    })

    expect(deleteConversationIfEmpty).toHaveBeenCalledWith(
      {},
      'conv-1',
      { accountId: 'acc-1', contactId: 'contact-1' },
    )
  })

  it('never deletes a conversation another webhook created or found', async () => {
    ensureConversation.mockResolvedValue({ id: 'conv-1', created: false })
    runFlowsForTrigger.mockResolvedValue({ started: [], skipped: [], no_active_flows: true })

    await dispatchShopifyFlows({
      db: {} as never,
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      triggerType: 'shopify_order_placed',
      context: baseContext,
    })

    expect(deleteConversationIfEmpty).not.toHaveBeenCalled()
  })

  it('skips contact and conversation setup when no active flow matches the trigger', async () => {
    hasActiveFlowsForTrigger.mockResolvedValue(false)

    const outcome = await dispatchShopifyFlows({
      db: {} as never,
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      triggerType: 'shopify_order_updated',
      context: baseContext,
    })

    expect(hasActiveFlowsForTrigger).toHaveBeenCalledWith('acc-1', 'shopify_order_updated')
    expect(ensureShopifyContact).not.toHaveBeenCalled()
    expect(ensureConversation).not.toHaveBeenCalled()
    expect(runFlowsForTrigger).not.toHaveBeenCalled()
    expect(deleteConversationIfEmpty).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ ok: false, dispatch: { no_active_flows: true } })
  })
})
