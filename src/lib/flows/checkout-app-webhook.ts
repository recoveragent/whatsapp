import {
  extractByPath,
  formatWebhookScalar,
} from '@/lib/automations/webhook-payload'
import { generateWebhookToken } from '@/lib/automations/webhook-token'
import type { FlowWebhookTriggerConfig } from './webhook-config'

/** Third-party Shopify checkout apps (GoKwik, Fastrr, Shopflo, Breeze, …). */
export function isCheckoutAppFlowTrigger(t: string): boolean {
  return t === 'shopify_checkout_app_abandoned'
}

export function isWebhookFlowTrigger(t: string): boolean {
  return t === 'webhook_received' || isCheckoutAppFlowTrigger(t)
}

/**
 * Generic starting paths — each provider differs. After the first test
 * webhook, map fields in the flow trigger panel to match your app.
 */
export function defaultCheckoutAppTriggerConfig(): FlowWebhookTriggerConfig {
  return {
    webhook_token: generateWebhookToken(),
    phone_path: 'phone',
    name_path: 'name',
    email_path: 'email',
    variable_mappings: {
      checkout_url: 'checkout_url',
      checkout_id: 'cart_id',
      order_total: 'total_price',
    },
  }
}

const PHONE_PATHS = [
  'phone',
  'data.phone',
  'customer.phone',
  'customer.phone_number',
  'data.customer.phone',
  'shipping_address.phone',
  'data.shipping_address.phone',
]

const CHECKOUT_URL_PATHS = [
  'checkout_url',
  'abandoned_checkout_url',
  'recovery_url',
  'cart_url',
  'data.checkout_url',
  'data.abandoned_checkout_url',
  'data.recovery_url',
]

const CHECKOUT_ID_PATHS = [
  'cart_id',
  'checkout_id',
  'id',
  'data.cart_id',
  'data.checkout_id',
  'data.id',
]

const LINE_ITEM_PATHS = [
  'line_items',
  'data.line_items',
  'items',
  'cart.items',
  'products',
  'data.products',
]

const TOTAL_PATHS = [
  'total_price',
  'cart_total',
  'amount',
  'data.total_price',
  'data.cart_total',
]

const IMAGE_PATHS = [
  'line_items.0.image_url',
  'line_items.0.image',
  'data.line_items.0.image_url',
  'items.0.image_url',
  'products.0.image_url',
]

const NAME_PATHS = [
  'name',
  'customer_name',
  'data.name',
  'data.customer_name',
  'customer.first_name',
  'data.customer.first_name',
  'data.customer.shipping_address.customer_name',
]

function firstStringAtPaths(payload: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const raw = extractByPath(payload, path)
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  }
  return null
}

interface LineItemLike {
  name?: string | null
  title?: string | null
  quantity?: number | null
}

function formatLineItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  const parts = items
    .map((raw) => {
      const item = raw as LineItemLike
      const name =
        (typeof item.name === 'string' ? item.name.trim() : '') ||
        (typeof item.title === 'string' ? item.title.trim() : '')
      if (!name) return null
      const qty =
        typeof item.quantity === 'number' && item.quantity > 1
          ? ` × ${item.quantity}`
          : ''
      return `${name}${qty}`
    })
    .filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

function resolveCustomerName(payload: unknown): string | null {
  const direct = firstStringAtPaths(payload, NAME_PATHS)
  if (direct) return direct

  for (const base of ['', 'data.', 'customer.', 'data.customer.']) {
    const first = extractByPath(payload, `${base}first_name`)
    const last = extractByPath(payload, `${base}last_name`)
    const parts = [first, last]
      .filter((v): v is string => typeof v === 'string' && !!v.trim())
      .map((v) => v.trim())
    if (parts.length > 0) return parts.join(' ')
  }

  return null
}

/** Fill Shopify-like template vars from common checkout-app webhook shapes. */
export function enrichCheckoutAppWebhookVars(
  payload: unknown,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...vars }

  if (!next.customer_name && !next.name) {
    const customerName = resolveCustomerName(payload)
    if (customerName) {
      next.customer_name = customerName
      next.name = customerName
    }
  }

  if (!next.checkout_url) {
    const checkoutUrl = firstStringAtPaths(payload, CHECKOUT_URL_PATHS)
    if (checkoutUrl) next.checkout_url = checkoutUrl
  }

  if (!next.checkout_id) {
    const checkoutId = firstStringAtPaths(payload, CHECKOUT_ID_PATHS)
    if (checkoutId) next.checkout_id = checkoutId
  }

  if (!next.order_total) {
    for (const path of TOTAL_PATHS) {
      const totalPrice = extractByPath(payload, path)
      if (totalPrice == null || typeof totalPrice === 'object') continue
      const formatted = formatWebhookScalar(totalPrice)
      next.order_total =
        typeof formatted === 'string' || typeof formatted === 'number'
          ? String(formatted)
          : formatted
      break
    }
  }

  if (!next.order_items) {
    for (const path of LINE_ITEM_PATHS) {
      const orderItems = formatLineItems(extractByPath(payload, path))
      if (orderItems) {
        next.order_items = orderItems
        break
      }
    }
  }

  if (!next.product_image) {
    const imageUrl = firstStringAtPaths(payload, IMAGE_PATHS)
    if (imageUrl) next.product_image = imageUrl
  }

  if (!next.email) {
    const email = firstStringAtPaths(payload, [
      'email',
      'data.email',
      'customer.email',
      'data.customer.email',
    ])
    if (email) next.email = email
  }

  if (!next.phone) {
    const phone = firstStringAtPaths(payload, PHONE_PATHS)
    if (phone) next.phone = phone
  }

  return next
}
