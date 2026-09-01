import {
  isShopifyFulfillmentFlowTrigger,
  resolveShipmentStatusKey,
} from './trigger-types'
import type { FlowRow } from './types'

/**
 * Stable dedupe key for externally triggered flow runs. Lets multiple
 * flows run for one contact while duplicate webhooks for the same
 * order/event do not start the same flow twice.
 */
export function buildExternalIdempotencyKey(
  flow: Pick<FlowRow, 'id' | 'trigger_type'>,
  vars?: Record<string, unknown> | null,
): string | null {
  const trigger = flow.trigger_type
  if (!trigger || !vars) return null

  if (trigger.startsWith('shopify_')) {
    const orderKey =
      typeof vars.order_number === 'string' && vars.order_number.trim()
        ? vars.order_number.trim()
        : typeof vars.shopify_order_id === 'string' && vars.shopify_order_id.trim()
          ? vars.shopify_order_id.trim()
          : null
    if (!orderKey) return null

    let key = `shopify:${trigger}:${orderKey}`
    if (isShopifyFulfillmentFlowTrigger(trigger)) {
      key += `:${resolveShipmentStatusKey(vars.shipment_status)}`
    }
    return key
  }

  if (trigger.startsWith('woocommerce_')) {
    const orderKey =
      typeof vars.order_number === 'string' && vars.order_number.trim()
        ? vars.order_number.trim()
        : typeof vars.woocommerce_order_id === 'string' &&
            vars.woocommerce_order_id.trim()
          ? vars.woocommerce_order_id.trim()
          : null
    if (!orderKey) return null
    return `woocommerce:${trigger}:${orderKey}`
  }

  if (trigger === 'webhook_received') {
    const bookingUid =
      typeof vars.booking_uid === 'string' && vars.booking_uid.trim()
        ? vars.booking_uid.trim()
        : null
    if (bookingUid) return `webhook:${flow.id}:${bookingUid}`
  }

  return null
}

export function isExternalIdempotencyConflict(error: {
  message?: string
  code?: string
} | null): boolean {
  if (!error) return false
  if (error.code === '23505') return true
  const msg = error.message ?? ''
  return msg.includes('23505') || msg.includes('duplicate key')
}
