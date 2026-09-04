import { beforeEach, describe, expect, it, vi } from 'vitest'

const { engineSendTemplate, ensureShopifyEventProductImage } = vi.hoisted(() => ({
  engineSendTemplate: vi.fn().mockResolvedValue({ whatsapp_message_id: 'wamid.1' }),
  ensureShopifyEventProductImage: vi.fn(
    async (_db: unknown, _accountId: unknown, context: { productImage?: string | null }) => ({
      ...context,
      productImage: context.productImage ?? 'https://cdn.shopify.com/product.jpg',
    }),
  ),
}))

vi.mock('@/lib/automations/meta-send', () => ({ engineSendTemplate }))
vi.mock('@/lib/flows/resolve-product-image', () => ({
  ensureShopifyEventProductImage,
}))
vi.mock('./ensure-contact', () => ({
  ensureShopifyContact: vi.fn().mockResolvedValue({ id: 'contact-1' }),
  ensureConversation: vi.fn().mockResolvedValue({ id: 'conv-1' }),
  deleteConversationIfEmpty: vi.fn(),
}))
vi.mock('@/lib/whatsapp/template-row-guard', () => ({
  isMessageTemplate: (row: unknown) => !!row,
}))

import { sendShopifyCampaign } from './send-campaign'

function mockDb(templateRow: Record<string, unknown> | null) {
  return {
    from: vi.fn((table: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }

      if (table === 'shopify_message_log') {
        chain.maybeSingle.mockResolvedValue({ data: null, error: null })
        return chain
      }
      if (table === 'message_templates') {
        chain.maybeSingle.mockResolvedValue({ data: templateRow, error: null })
        return chain
      }
      return chain
    }),
  }
}

describe('sendShopifyCampaign header media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires product image for media-header templates instead of template sample fallback', async () => {
    const db = mockDb({
      name: 'order_placed_cod',
      language: 'en_US',
      header_type: 'image',
      header_media_url: 'https://example.com/template-sample.jpg',
      body_text: 'Hi {{1}}',
    })

    await sendShopifyCampaign({
      db: db as never,
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      campaign: {
        id: 'c1',
        account_id: 'acc-1',
        campaign_type: 'order_confirmation',
        is_enabled: true,
        template_name: 'order_placed_cod',
        template_language: 'en_US',
        variable_mapping: { '1': 'customer_name', '2': 'order_number' },
        delay_minutes: 0,
        created_at: '',
        updated_at: '',
      },
      context: {
        customerName: 'Mohan',
        phone: '918007632049',
        email: null,
        orderNumber: '#TTF10134',
        orderTotal: '648 INR',
        orderItems: 'Widget',
        productImage: null,
        shippingAddress: null,
        shippingAddressFields: null,
        trackingNumber: null,
        trackingUrl: null,
        trackingRedirectSuffix: null,
        orderStatusUrl: null,
        orderStatusUrlSuffix: '/1234567890/orders/abc',
        checkoutUrl: null,
        fulfillmentStatus: null,
        shipmentStatus: null,
        financialStatus: 'pending',
        shopName: 'demo',
        resourceKey: 'order:999',
      },
    })

    expect(ensureShopifyEventProductImage).toHaveBeenCalled()
    expect(engineSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.objectContaining({
          headerMediaUrl: 'https://cdn.shopify.com/product.jpg',
          headerMediaRequired: true,
        }),
      }),
    )
  })
})
