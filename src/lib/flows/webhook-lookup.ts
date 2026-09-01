import type { FlowRow } from './types'
import type { FlowWebhookTriggerConfig } from './webhook-config'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWebhookToken } from '@/lib/automations/webhook-lookup'
import { isWebhookFlowTrigger } from './checkout-app-webhook'

export function normalizeFlowWebhookToken(raw: string): string {
  return normalizeWebhookToken(raw)
}

const WEBHOOK_FLOW_TRIGGER_TYPES = [
  'webhook_received',
  'shopify_checkout_app_abandoned',
] as const

export async function findFlowByWebhookToken(
  db: SupabaseClient,
  rawToken: string,
): Promise<FlowRow | null> {
  const token = normalizeFlowWebhookToken(rawToken)
  if (!token) return null

  // Include draft/paused flows so Cal.com (and other) ping tests can
  // store a sample payload. handleFlowInboundWebhook only *runs* the
  // flow when status === 'active'.
  for (const triggerType of WEBHOOK_FLOW_TRIGGER_TYPES) {
    const { data: byPath } = await db
      .from('flows')
      .select('*')
      .eq('trigger_type', triggerType)
      .filter('trigger_config->>webhook_token', 'eq', token)
      .maybeSingle()

    if (byPath) return byPath as FlowRow
  }

  const { data: rows } = await db
    .from('flows')
    .select('*')
    .in('trigger_type', [...WEBHOOK_FLOW_TRIGGER_TYPES])

  return (
    ((rows as FlowRow[] | null) ?? []).find((f) => {
      if (!isWebhookFlowTrigger(f.trigger_type)) return false
      const cfg = f.trigger_config as unknown as FlowWebhookTriggerConfig
      return cfg?.webhook_token === token
    }) ?? null
  )
}
