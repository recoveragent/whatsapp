/**
 * Cal.com (and similar) booking lifecycle helpers for flow webhooks:
 * trigger-event allow-lists and cancelling reminder runs by booking uid.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const OPEN_RUN_STATUSES = ['active', 'waiting'] as const

export function extractWebhookTriggerEvent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const event = (payload as Record<string, unknown>).triggerEvent
  return typeof event === 'string' && event.trim() ? event.trim() : null
}

/**
 * Cal.com BOOKING_* payloads nest `uid` under `payload`; MEETING_* may be flat.
 */
export function extractBookingUid(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const root = payload as Record<string, unknown>
  if (typeof root.uid === 'string' && root.uid.trim()) return root.uid.trim()

  const nested = root.payload
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const uid = (nested as Record<string, unknown>).uid
    if (typeof uid === 'string' && uid.trim()) return uid.trim()
  }
  return null
}

/** Empty / missing allow-list = allow all events. */
export function isTriggerEventAllowed(
  event: string | null,
  allowed?: string[] | null,
): boolean {
  if (!allowed || allowed.length === 0) return true
  const normalized = allowed.map((a) => a.trim()).filter(Boolean)
  if (normalized.length === 0) return true
  // Payloads without triggerEvent are not blocked (generic webhooks).
  if (!event) return true
  return normalized.includes(event)
}

export function normalizeAllowedTriggerEvents(
  raw: unknown,
): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

/**
 * End open flow runs for this account whose vars.booking_uid matches,
 * and fail their pending executions (reminder waits).
 */
export async function cancelFlowRunsByBookingUid(
  db: SupabaseClient,
  accountId: string,
  bookingUid: string,
): Promise<{ cancelledRunIds: string[] }> {
  const uid = bookingUid.trim()
  if (!uid) return { cancelledRunIds: [] }

  const { data, error } = await db
    .from('flow_runs')
    .select('id, current_node_key')
    .eq('account_id', accountId)
    .in('status', [...OPEN_RUN_STATUSES])
    .filter('vars->>booking_uid', 'eq', uid)

  if (error) {
    console.error('[flows] cancelFlowRunsByBookingUid load:', error.message)
    return { cancelledRunIds: [] }
  }

  const cancelledRunIds: string[] = []
  const now = new Date().toISOString()

  for (const row of data ?? []) {
    const run = row as { id: string; current_node_key: string | null }
    await db
      .from('flow_runs')
      .update({
        status: 'completed',
        ended_at: now,
        end_reason: 'booking_cancelled',
      })
      .eq('id', run.id)
      .in('status', [...OPEN_RUN_STATUSES])

    await db
      .from('flow_pending_executions')
      .update({ status: 'failed' })
      .eq('flow_run_id', run.id)
      .eq('status', 'pending')

    await db.from('flow_run_events').insert({
      flow_run_id: run.id,
      event_type: 'completed',
      node_key: run.current_node_key,
      payload: { reason: 'booking_cancelled', booking_uid: uid },
    })

    cancelledRunIds.push(run.id)
  }

  return { cancelledRunIds }
}
