import type { SupabaseClient } from '@supabase/supabase-js'

import { enrichContextProductImage } from '@/lib/shopify/enrich-product-image'
import type { ShopifyEventContext } from '@/lib/shopify/types'

type AdminClient = SupabaseClient

function orderIdFromVars(vars: Record<string, unknown>): string | null {
  const direct = vars.shopify_order_id
  if (direct != null && String(direct).trim()) return String(direct).trim()

  const resourceKey = vars.resource_key ?? vars.resourceKey
  if (typeof resourceKey === 'string' && resourceKey.startsWith('order:')) {
    const id = resourceKey.slice('order:'.length).trim()
    return id || null
  }

  return null
}

function existingProductImage(vars: Record<string, unknown>): string | undefined {
  const raw = vars.product_image
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed || undefined
}

/**
 * Resolve a public product image URL for flow template headers.
 * REST Shopify webhooks often omit line-item images; when `product_image`
 * is empty but we know the order id, look it up via Admin API.
 */
export async function resolveFlowProductImageUrl(
  db: AdminClient,
  accountId: string,
  vars: Record<string, unknown>,
): Promise<string | undefined> {
  const cached = existingProductImage(vars)
  if (cached) return cached

  const orderId = orderIdFromVars(vars)
  if (!orderId) return undefined

  const { data: config } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle()

  if (
    !config ||
    config.status !== 'connected' ||
    typeof config.access_token !== 'string' ||
    typeof config.shop_domain !== 'string'
  ) {
    return undefined
  }

  const stubContext: ShopifyEventContext = {
    customerName: '',
    phone: null,
    email: null,
    orderNumber: null,
    orderTotal: null,
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
    financialStatus: null,
    shopName: '',
    resourceKey: `order:${orderId}`,
  }

  try {
    const enriched = await enrichContextProductImage({
      context: stubContext,
      shopDomain: config.shop_domain,
      encryptedAccessToken: config.access_token,
      orderId,
    })
    return enriched.productImage?.trim() || undefined
  } catch (err) {
    console.warn('[flows] resolveFlowProductImageUrl failed:', err)
    return undefined
  }
}
