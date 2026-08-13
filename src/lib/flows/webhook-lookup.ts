import type { FlowRow } from './types'
import type { FlowWebhookTriggerConfig } from './webhook-config'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWebhookToken } from '@/lib/automations/webhook-lookup'

export function normalizeFlowWebhookToken(raw: string): string {
  return normalizeWebhookToken(raw)
}

export async function findFlowByWebhookToken(
  db: SupabaseClient,
  rawToken: string,
): Promise<FlowRow | null> {
  const token = normalizeFlowWebhookToken(rawToken)
  if (!token) return null

  // Include draft/paused flows so Cal.com (and other) ping tests can
  // store a sample payload. handleFlowInboundWebhook only *runs* the
  // flow when status === 'active'.
  const { data: byPath } = await db
    .from('flows')
    .select('*')
    .eq('trigger_type', 'webhook_received')
    .filter('trigger_config->>webhook_token', 'eq', token)
    .maybeSingle()

  if (byPath) return byPath as FlowRow

  const { data: rows } = await db
    .from('flows')
    .select('*')
    .eq('trigger_type', 'webhook_received')

  return (
    ((rows as FlowRow[] | null) ?? []).find((f) => {
      const cfg = f.trigger_config as unknown as FlowWebhookTriggerConfig
      return cfg?.webhook_token === token
    }) ?? null
  )
}
