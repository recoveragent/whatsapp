import { isEcommerceBrand, isLeadGenBrand, type BrandCategory } from '@/lib/auth/brand-category'
import {
  resolveEcommercePlatform,
  type EcommercePlatform,
} from '@/lib/ecommerce/platform'

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
  'woocommerce_order_placed',
  'woocommerce_order_updated',
  'woocommerce_order_completed',
  'woocommerce_order_cancelled',
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
  'woocommerce_order_placed',
  'woocommerce_order_updated',
  'woocommerce_order_completed',
  'woocommerce_order_cancelled',
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
  woocommerce_order_placed: 'WooCommerce: order placed',
  woocommerce_order_updated: 'WooCommerce: order updated',
  woocommerce_order_completed: 'WooCommerce: order completed',
  woocommerce_order_cancelled: 'WooCommerce: order cancelled',
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
  ecommercePlatform?: EcommercePlatform | null,
): FlowTriggerType[] {
  const platform = resolveEcommercePlatform(category, ecommercePlatform)
  return FLOW_TRIGGER_TYPES.filter((t) => {
    if (t === 'google_sheet_row') {
      return isLeadGenBrand(category) || current === 'google_sheet_row'
    }
    if (t.startsWith('shopify_')) {
      return (
        (isEcommerceBrand(category) && platform === 'shopify') || current === t
      )
    }
    if (t.startsWith('woocommerce_')) {
      return (
        (isEcommerceBrand(category) && platform === 'woocommerce') ||
        current === t
      )
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

/** Filter key when Shopify omits shipment_status on fulfillments/create. */
export const SHOPIFY_SHIPMENT_NONE_KEY = '__none__'

export const SHOPIFY_SHIPMENT_NONE_LABEL = 'No status (initial fulfill)'

export function isShopifyShipmentNoneKey(status: string): boolean {
  return status === SHOPIFY_SHIPMENT_NONE_KEY
}

export function normalizeShopifyShipmentStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return value || null
}

/** Normalize trigger filter values, including the synthetic none key. */
export function normalizeShipmentStatusFilter(raw: unknown): string | null {
  if (raw === SHOPIFY_SHIPMENT_NONE_KEY) return SHOPIFY_SHIPMENT_NONE_KEY
  return normalizeShopifyShipmentStatus(raw)
}

/** Map webhook vars to a stable routing / dedupe key. */
export function resolveShipmentStatusKey(actual: unknown): string {
  const normalized = normalizeShopifyShipmentStatus(actual)
  return normalized ?? SHOPIFY_SHIPMENT_NONE_KEY
}

export function shipmentStatusMatchesFilter(
  want: string | string[] | undefined,
  actual: unknown,
): boolean {
  const list = (Array.isArray(want) ? want : want ? [want] : [])
    .map((s) => normalizeShipmentStatusFilter(s))
    .filter((s): s is string => !!s && s !== 'any')
  if (list.length === 0) return true
  const got = resolveShipmentStatusKey(actual)
  return list.includes(got)
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

export function isSelectableShipmentStatusFilter(status: string): boolean {
  return (
    isShopifyShipmentNoneKey(status) || isShopifyShipmentBranchStatus(status)
  )
}

export function shipmentStatusFilterLabel(status: string): string {
  if (isShopifyShipmentNoneKey(status)) return SHOPIFY_SHIPMENT_NONE_LABEL
  const label =
    SHOPIFY_SHIPMENT_STATUS_LABELS[status as ShopifyShipmentStatus]
  return label ?? status.replace(/_/g, ' ')
}

export function selectedShipmentStatuses(
  config: Record<string, unknown> | null | undefined,
): string[] {
  if (!config) return []
  if (Array.isArray(config.shipment_statuses)) {
    const out: string[] = []
    for (const raw of config.shipment_statuses) {
      const normalized = normalizeShipmentStatusFilter(raw)
      if (normalized && normalized !== 'any' && !out.includes(normalized)) {
        out.push(normalized)
      }
    }
    return out
  }
  const single = normalizeShipmentStatusFilter(config.shipment_status)
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
    const status = normalizeShipmentStatusFilter(key)
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
    const actual = resolveShipmentStatusKey(args.vars?.shipment_status)
    const routes = shipmentRoutesFromConfig(cfg)
    if (routes[actual]) return routes[actual]!
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
  return normalizeShipmentStatusFilter(handle.slice('shipment:'.length))
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

/** WooCommerce order webhook triggers that support order-status filtering. */
export const WOOCOMMERCE_ORDER_FLOW_TRIGGERS = [
  'woocommerce_order_placed',
  'woocommerce_order_updated',
  'woocommerce_order_completed',
  'woocommerce_order_cancelled',
] as const satisfies readonly FlowTriggerType[]

export type WooCommerceOrderFlowTrigger =
  (typeof WOOCOMMERCE_ORDER_FLOW_TRIGGERS)[number]

export const WOOCOMMERCE_ORDER_STATUSES = [
  'any',
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
] as const

export type WooCommerceOrderStatus = (typeof WOOCOMMERCE_ORDER_STATUSES)[number]

export const WOOCOMMERCE_ORDER_STATUS_LABELS: Record<WooCommerceOrderStatus, string> = {
  any: 'Any order status',
  pending: 'Pending payment',
  processing: 'Processing',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
}

export function isWooCommerceOrderFlowTrigger(
  t: string,
): t is WooCommerceOrderFlowTrigger {
  return (WOOCOMMERCE_ORDER_FLOW_TRIGGERS as readonly string[]).includes(t)
}

export function isStoreOrderFlowTrigger(t: string): boolean {
  return isShopifyOrderFlowTrigger(t) || isWooCommerceOrderFlowTrigger(t)
}

export function defaultWooCommerceTriggerConfig(
  _triggerType: string,
): Record<string, unknown> {
  return { payment_status: 'any' }
}

/** Map WooCommerce webhook topics to flow trigger types. */
export function woocommerceTopicToFlowTrigger(
  topic: string,
  order?: { status?: string | null },
): FlowTriggerType | null {
  const status = order?.status?.trim().toLowerCase() ?? null

  switch (topic) {
    case 'order.created':
      return 'woocommerce_order_placed'
    case 'order.updated':
      if (status === 'cancelled') return 'woocommerce_order_cancelled'
      if (status === 'completed') return 'woocommerce_order_completed'
      return 'woocommerce_order_updated'
    default:
      return null
  }
}
