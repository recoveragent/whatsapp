import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'

export const ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_DEFAULT = 30
export const ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_MIN = 1
export const ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_MAX = 365

export const ABANDONED_CHECKOUT_FLOW_TRIGGERS = [
  'shopify_checkout_abandoned',
  'shopify_checkout_app_abandoned',
] as const

export type AbandonedCheckoutFlowTrigger =
  (typeof ABANDONED_CHECKOUT_FLOW_TRIGGERS)[number]

export function isAbandonedCheckoutFlowTrigger(t: string): t is AbandonedCheckoutFlowTrigger {
  return (ABANDONED_CHECKOUT_FLOW_TRIGGERS as readonly string[]).includes(t)
}

export function clampSkipRecentOrderDays(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.min(
    ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_MAX,
    Math.max(ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_MIN, Math.floor(raw)),
  )
}

/** Days to look back when enabled; null when the gate is off. */
export function resolveSkipRecentOrderDays(
  cfg: Record<string, unknown> | null | undefined,
): number | null {
  if (!cfg?.skip_recent_order_enabled) return null
  return (
    clampSkipRecentOrderDays(cfg.skip_recent_order_days) ??
    ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_DEFAULT
  )
}

function phoneSuffix(phone: string): string | null {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  if (normalized.length >= 10) return normalized.slice(-10)
  if (normalized.length >= 8) return normalized.slice(-8)
  return normalized
}

/**
 * True when this contact has a non-cancelled Shopify order within the last
 * `withinDays` days (cached `shopify_orders` table).
 */
export async function contactHasRecentShopifyOrder(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    phone: string | null
    withinDays: number
    nowMs?: number
  },
): Promise<boolean> {
  const nowMs = args.nowMs ?? Date.now()
  const sinceIso = new Date(
    nowMs - args.withinDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: byContact, error: contactErr } = await db
    .from('shopify_orders')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .gte('ordered_at', sinceIso)
    .or('order_status.is.null,order_status.neq.cancelled')
    .limit(1)
    .maybeSingle()

  if (contactErr) {
    console.error('[flows] recent order check (contact) failed:', contactErr.message)
    return false
  }
  if (byContact) return true

  const suffix = args.phone ? phoneSuffix(args.phone) : null
  if (!suffix) return false

  const { data: candidates, error: phoneErr } = await db
    .from('shopify_orders')
    .select('id, customer_phone')
    .eq('account_id', args.accountId)
    .not('customer_phone', 'is', null)
    .like('customer_phone', `%${suffix}`)
    .gte('ordered_at', sinceIso)
    .or('order_status.is.null,order_status.neq.cancelled')
    .limit(50)

  if (phoneErr) {
    console.error('[flows] recent order check (phone) failed:', phoneErr.message)
    return false
  }

  const normalizedPhone = normalizePhone(args.phone!)
  for (const row of candidates ?? []) {
    const phone = (row as { customer_phone?: string | null }).customer_phone
    if (phone && phonesMatch(phone, normalizedPhone)) return true
  }

  return false
}

export async function resolveContactPhoneForDispatch(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  varsPhone: unknown,
): Promise<string | null> {
  if (typeof varsPhone === 'string' && varsPhone.trim()) return varsPhone.trim()

  const { data, error } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[flows] resolveContactPhoneForDispatch failed:', error.message)
    return null
  }

  const phone = (data as { phone?: string | null } | null)?.phone
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null
}
