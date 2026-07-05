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
}

export function isExternalFlowTrigger(t: string): t is FlowTriggerType {
  return (EXTERNAL_FLOW_TRIGGERS as string[]).includes(t)
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
