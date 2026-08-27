import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ensureShopifyContact,
  ensureConversation,
  deleteConversationIfEmpty,
  runFlowsForTrigger,
} = vi.hoisted(() => ({
  ensureShopifyContact: vi.fn(),
  ensureConversation: vi.fn(),
  deleteConversationIfEmpty: vi.fn(),
  runFlowsForTrigger: vi.fn(),
}))

vi.mock('@/lib/shopify/ensure-contact', () => ({
  ensureShopifyContact,
  ensureConversation,
  deleteConversationIfEmpty,
}))

vi.mock('./dispatch-external', () => ({ runFlowsForTrigger }))

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
  checkoutUrl: null,
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
    ensureConversation.mockResolvedValue({ id: 'conv-1' })
  })

  it('does not delete conversation when duplicate webhook hit active_run_exists', async () => {
    runFlowsForTrigger.mockResolvedValue({
      started: [],
      skipped: [
        {
          flow_id: 'flow-1',
          flow_name: 'Prepaid order placed',
          reason: 'active_run_exists',
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

    expect(deleteConversationIfEmpty).not.toHaveBeenCalled()
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
})
