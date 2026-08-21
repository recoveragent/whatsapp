import { isLeadGenBrand, type BrandCategory } from '@/lib/auth/brand-category'

/**
 * Flow trigger types — parity with automations where applicable.
 */

export const FLOW_TRIGGER_TYPES = [
  'keyword',
  'first_inbound_message',
  'manual',
  'new_message_received',
  'webhook_received',
  'shopify_order_placed',
  'shopify_order_updated',
  'shopify_order_fulfilled',
  'shopify_order_cancelled',
  'shopify_order_partially_fulfilled',
  'tag_added',
  'conversation_assigned',
  'time_based',
  'google_sheet_row',
] as const

export type FlowTriggerType = (typeof FLOW_TRIGGER_TYPES)[number]

/** Triggers that start from external events (not WhatsApp inbound text). */
export const EXTERNAL_FLOW_TRIGGERS: FlowTriggerType[] = [
  'webhook_received',
  'shopify_order_placed',
  'shopify_order_updated',
  'shopify_order_fulfilled',
  'shopify_order_cancelled',
  'shopify_order_partially_fulfilled',
  'tag_added',
  'conversation_assigned',
  'time_based',
  'google_sheet_row',
]

export const FLOW_TRIGGER_LABELS: Record<FlowTriggerType, string> = {
  keyword: 'Keyword match',
  first_inbound_message: "Customer's first inbound message",
  manual: 'Manual only',
  new_message_received: 'Any new message received',
  webhook_received: 'Webhook (external POST)',
  shopify_order_placed: 'Shopify: order placed',
  shopify_order_updated: 'Shopify: order updated',
  shopify_order_fulfilled: 'Shopify: order fulfilled',
  shopify_order_cancelled: 'Shopify: order cancelled',
  shopify_order_partially_fulfilled: 'Shopify: order partially fulfilled',
  tag_added: 'Tag added to contact',
  conversation_assigned: 'Conversation assigned',
  time_based: 'Time-based schedule',
  google_sheet_row: 'Google Sheet: new row',
}

export function isExternalFlowTrigger(t: string): t is FlowTriggerType {
  return (EXTERNAL_FLOW_TRIGGERS as string[]).includes(t)
}

/** Triggers offered in the flow builder for this brand category. */
export function flowTriggersForBrand(
  category: BrandCategory | null | undefined,
  current?: FlowTriggerType,
): FlowTriggerType[] {
  return FLOW_TRIGGER_TYPES.filter((t) => {
    if (t === 'google_sheet_row') {
      return isLeadGenBrand(category) || current === 'google_sheet_row'
    }
    return true
  })
}

/** Shopify order webhook triggers that support payment-status filtering. */
export const SHOPIFY_ORDER_FLOW_TRIGGERS = [
  'shopify_order_placed',
  'shopify_order_updated',
  'shopify_order_fulfilled',
  'shopify_order_cancelled',
  'shopify_order_partially_fulfilled',
] as const satisfies readonly FlowTriggerType[]

export type ShopifyOrderFlowTrigger = (typeof SHOPIFY_ORDER_FLOW_TRIGGERS)[number]

export const SHOPIFY_PAYMENT_STATUSES = [
  'any',
  'paid',
  'pending',
  'partially_paid',
] as const

export type ShopifyPaymentStatus = (typeof SHOPIFY_PAYMENT_STATUSES)[number]

export const SHOPIFY_PAYMENT_STATUS_LABELS: Record<ShopifyPaymentStatus, string> = {
  any: 'Any payment status',
  paid: 'Paid',
  pending: 'Pending',
  partially_paid: 'Partially paid',
}

export function isShopifyOrderFlowTrigger(
  t: string,
): t is ShopifyOrderFlowTrigger {
  return (SHOPIFY_ORDER_FLOW_TRIGGERS as readonly string[]).includes(t)
}

/** Fulfilled / partially-fulfilled — driven by fulfillments/create and update. */
export const SHOPIFY_FULFILLMENT_FLOW_TRIGGERS = [
  'shopify_order_fulfilled',
  'shopify_order_partially_fulfilled',
] as const satisfies readonly FlowTriggerType[]

export type ShopifyFulfillmentFlowTrigger =
  (typeof SHOPIFY_FULFILLMENT_FLOW_TRIGGERS)[number]

export function isShopifyFulfillmentFlowTrigger(
  t: string,
): t is ShopifyFulfillmentFlowTrigger {
  return (SHOPIFY_FULFILLMENT_FLOW_TRIGGERS as readonly string[]).includes(t)
}

export const SHOPIFY_SHIPMENT_STATUSES = [
  'any',
  'confirmed',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'ready_for_pickup',
  'attempted_delivery',
  'label_printed',
  'label_purchased',
  'failure',
] as const

export type ShopifyShipmentStatus = (typeof SHOPIFY_SHIPMENT_STATUSES)[number]

export const SHOPIFY_SHIPMENT_STATUS_LABELS: Record<ShopifyShipmentStatus, string> = {
  any: 'Any shipment status',
  confirmed: 'Confirmed',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  ready_for_pickup: 'Ready for pickup',
  attempted_delivery: 'Attempted delivery',
  label_printed: 'Label printed',
  label_purchased: 'Label purchased',
  failure: 'Failure',
}

export function normalizeShopifyShipmentStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return value || null
}

export function shipmentStatusMatchesFilter(
  want: string | undefined,
  actual: unknown,
): boolean {
  if (!want || want === 'any') return true
  return normalizeShopifyShipmentStatus(actual) === want
}

export function defaultShopifyTriggerConfig(
  triggerType: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = { payment_status: 'any' }
  if (isShopifyFulfillmentFlowTrigger(triggerType)) {
    config.shipment_status = 'any'
  }
  return config
}

/** Map Shopify webhook topics to flow trigger types. */
export function shopifyTopicToFlowTrigger(
  topic: string,
  order?: { cancelled_at?: string | null; fulfillment_status?: string | null },
): FlowTriggerType | null {
  switch (topic) {
    case 'orders/create':
      return 'shopify_order_placed'
    case 'orders/updated':
      if (order?.cancelled_at) return 'shopify_order_cancelled'
      return 'shopify_order_updated'
    case 'fulfillments/create':
    case 'fulfillments/update':
      if (order?.fulfillment_status === 'partial') {
        return 'shopify_order_partially_fulfilled'
      }
      return 'shopify_order_fulfilled'
    default:
      return null
  }
}
