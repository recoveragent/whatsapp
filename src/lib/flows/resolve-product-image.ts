import type { SupabaseClient } from '@supabase/supabase-js'

import { enrichContextProductImage } from '@/lib/shopify/enrich-product-image'
import type { ShopifyEventContext } from '@/lib/shopify/types'

type AdminClient = SupabaseClient

function orderIdFromResourceKey(vars: Record<string, unknown>): string | null {
  const direct = vars.shopify_order_id
  if (direct != null && String(direct).trim()) return String(direct).trim()

  const resourceKey = vars.resource_key ?? vars.resourceKey
  if (typeof resourceKey === 'string' && resourceKey.startsWith('order:')) {
    const id = resourceKey.slice('order:'.length).trim()
    return id || null
  }

  return null
}

async function orderIdFromShopifyOrdersTable(
  db: AdminClient,
  accountId: string,
  orderNumber: string,
): Promise<string | null> {
  const trimmed = orderNumber.trim()
  if (!trimmed) return null

  const candidates = [trimmed]
  if (trimmed.startsWith('#')) {
    candidates.push(trimmed.slice(1))
  } else {
    candidates.push(`#${trimmed}`)
  }

  for (const candidate of candidates) {
    const { data } = await db
      .from('shopify_orders')
      .select('shopify_order_id')
      .eq('account_id', accountId)
      .eq('order_number', candidate)
      .maybeSingle()

    const id = (data as { shopify_order_id?: string } | null)?.shopify_order_id
    if (id?.trim()) return id.trim()
  }

  return null
}

async function resolveOrderId(
  db: AdminClient,
  accountId: string,
  vars: Record<string, unknown>,
): Promise<string | null> {
  const fromVars = orderIdFromResourceKey(vars)
  if (fromVars) return fromVars

  const orderNumber = vars.order_number
  if (typeof orderNumber === 'string') {
    return orderIdFromShopifyOrdersTable(db, accountId, orderNumber)
  }

  return null
}

function existingProductImage(vars: Record<string, unknown>): string | undefined {
  const raw = vars.product_image
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed || undefined
}

async function loadShopifyConfig(db: AdminClient, accountId: string) {
  const { data } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle()

  if (
    !data ||
    data.status !== 'connected' ||
    typeof data.access_token !== 'string' ||
    typeof data.shop_domain !== 'string'
  ) {
    return null
  }

  return data
}

function orderIdFromContext(context: ShopifyEventContext): string | null {
  if (!context.resourceKey.startsWith('order:')) return null
  const id = context.resourceKey.slice('order:'.length).trim()
  return id || null
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

  const orderId = await resolveOrderId(db, accountId, vars)
  if (!orderId) return undefined

  const config = await loadShopifyConfig(db, accountId)
  if (!config) return undefined

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

/** Ensure Shopify campaign / webhook context has a product image when possible. */
export async function ensureShopifyEventProductImage(
  db: AdminClient,
  accountId: string,
  context: ShopifyEventContext,
): Promise<ShopifyEventContext> {
  if (context.productImage?.trim()) return context

  const config = await loadShopifyConfig(db, accountId)
  if (!config) return context

  const orderId = orderIdFromContext(context)
  if (!orderId && context.orderNumber) {
    const fromTable = await orderIdFromShopifyOrdersTable(
      db,
      accountId,
      context.orderNumber,
    )
    if (fromTable) {
      return enrichContextProductImage({
        context: { ...context, resourceKey: `order:${fromTable}` },
        shopDomain: config.shop_domain,
        encryptedAccessToken: config.access_token,
        orderId: fromTable,
      })
    }
  }

  if (!orderId) return context

  return enrichContextProductImage({
    context,
    shopDomain: config.shop_domain,
    encryptedAccessToken: config.access_token,
    orderId,
  })
}
