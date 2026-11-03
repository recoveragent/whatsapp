import type { SupabaseClient } from '@supabase/supabase-js'

import { loadCampaign } from './send-campaign'

import {
  SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_DEFAULT,
  SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_MIN,
  SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_MAX,
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_DEFAULT,
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_MIN,
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_MAX
} from './abandoned-checkout-constants'
export {
  SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_DEFAULT,
  SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_MIN,
  SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_MAX,
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_DEFAULT,
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_MIN,
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_MAX
} from './abandoned-checkout-constants'

/** Drop queued checkouts whose send time is older than this — stale carts. */
export function resolveAbandonedCheckoutMaxAgeMs(nowMs = Date.now()): number {
  const raw = process.env.ABANDONED_CHECKOUT_MAX_AGE_HOURS
  const parsed =
    raw != null && raw.trim() !== ''
      ? Number.parseInt(raw, 10)
      : ABANDONED_CHECKOUT_MAX_AGE_HOURS_DEFAULT
  const hours = Number.isFinite(parsed)
    ? Math.min(
        ABANDONED_CHECKOUT_MAX_AGE_HOURS_MAX,
        Math.max(ABANDONED_CHECKOUT_MAX_AGE_HOURS_MIN, parsed),
      )
    : ABANDONED_CHECKOUT_MAX_AGE_HOURS_DEFAULT
  return hours * 60 * 60 * 1000
}

export function isAbandonedCheckoutStale(
  runAtIso: string,
  nowMs = Date.now(),
): boolean {
  const runAt = Date.parse(runAtIso)
  if (!Number.isFinite(runAt)) return true
  return nowMs - runAt > resolveAbandonedCheckoutMaxAgeMs(nowMs)
}

function clampDelayMinutes(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.min(
    SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_MAX,
    Math.max(SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_MIN, Math.floor(raw)),
  )
}

/**
 * Shortest wait among active native abandonment flows and the legacy
 * abandoned-checkout campaign. Returns null when nothing should queue.
 */
export async function resolveAbandonedCheckoutDelayMinutes(
  db: SupabaseClient,
  accountId: string,
): Promise<number | null> {
  const delays: number[] = []

  const { data: flows } = await db
    .from('flows')
    .select('trigger_config')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .eq('trigger_type', 'shopify_checkout_abandoned')

  for (const flow of flows ?? []) {
    const cfg = flow.trigger_config as Record<string, unknown> | null
    const delay = clampDelayMinutes(cfg?.delay_minutes)
    delays.push(delay ?? SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_DEFAULT)
  }

  const campaign = await loadCampaign(db, accountId, 'abandoned_checkout')
  if (campaign?.is_enabled) {
    delays.push(campaign.delay_minutes ?? SHOPIFY_CHECKOUT_ABANDONMENT_DELAY_DEFAULT)
  }

  if (delays.length === 0) return null
  return Math.min(...delays)
}

export async function hasNativeCheckoutAbandonmentHandlers(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  return (await resolveAbandonedCheckoutDelayMinutes(db, accountId)) != null
}
