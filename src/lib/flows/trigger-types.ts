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
  want: string | string[] | undefined,
  actual: unknown,
): boolean {
  const list = (Array.isArray(want) ? want : want ? [want] : [])
    .map((s) => normalizeShopifyShipmentStatus(s))
    .filter((s): s is string => !!s && s !== 'any')
  if (list.length === 0) return true
  const got = normalizeShopifyShipmentStatus(actual)
  return got != null && list.includes(got)
}

/** Statuses that can branch off a fulfilled trigger (excludes "any"). */
export type ShopifyShipmentBranchStatus = Exclude<ShopifyShipmentStatus, 'any'>

export const SHOPIFY_SHIPMENT_BRANCH_STATUSES = SHOPIFY_SHIPMENT_STATUSES.filter(
  (s): s is ShopifyShipmentBranchStatus => s !== 'any',
)

export function isShopifyShipmentBranchStatus(
  status: string,
): status is ShopifyShipmentBranchStatus {
  return (SHOPIFY_SHIPMENT_BRANCH_STATUSES as readonly string[]).includes(status)
}

export function selectedShipmentStatuses(
  config: Record<string, unknown> | null | undefined,
): string[] {
  if (!config) return []
  if (Array.isArray(config.shipment_statuses)) {
    const out: string[] = []
    for (const raw of config.shipment_statuses) {
      const normalized = normalizeShopifyShipmentStatus(raw)
      if (normalized && normalized !== 'any' && !out.includes(normalized)) {
        out.push(normalized)
      }
    }
    return out
  }
  const single = normalizeShopifyShipmentStatus(config.shipment_status)
  if (single && single !== 'any') return [single]
  return []
}

export function shipmentRoutesFromConfig(
  config: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const raw = config?.shipment_routes
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const status = normalizeShopifyShipmentStatus(key)
    if (!status || typeof value !== 'string' || !value.trim()) continue
    out[status] = value.trim()
  }
  return out
}

export function flowMatchesShipmentConfig(
  config: Record<string, unknown>,
  actual: unknown,
): boolean {
  return shipmentStatusMatchesFilter(selectedShipmentStatuses(config), actual)
}

export function resolveFlowStartNodeKey(args: {
  entry_node_id: string | null
  trigger_type: string
  trigger_config?: Record<string, unknown> | null
  vars?: Record<string, unknown> | null
}): string | null {
  const cfg = args.trigger_config ?? {}
  if (isShopifyFulfillmentFlowTrigger(args.trigger_type)) {
    const actual = normalizeShopifyShipmentStatus(args.vars?.shipment_status)
    const routes = shipmentRoutesFromConfig(cfg)
    if (actual && routes[actual]) return routes[actual]!
  }
  const entry = args.entry_node_id?.trim()
  return entry || null
}

export function collectFlowStartNodeKeys(args: {
  entry_node_id: string | null
  trigger_config?: Record<string, unknown> | null
}): string[] {
  const keys: string[] = []
  const entry = args.entry_node_id?.trim()
  if (entry) keys.push(entry)
  for (const next of Object.values(shipmentRoutesFromConfig(args.trigger_config))) {
    if (!keys.includes(next)) keys.push(next)
  }
  return keys
}

export function shipmentHandleId(status: string): string {
  return `shipment:${status}`
}

export function shipmentStatusFromHandle(handle: string): string | null {
  if (!handle.startsWith('shipment:')) return null
  return normalizeShopifyShipmentStatus(handle.slice('shipment:'.length))
}

export function defaultShopifyTriggerConfig(
  triggerType: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = { payment_status: 'any' }
  if (isShopifyFulfillmentFlowTrigger(triggerType)) {
    config.shipment_status = 'any'
    config.shipment_statuses = []
    config.shipment_routes = {}
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
