import type { Automation, WebhookTriggerConfig } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Normalize the token from a URL path segment (or a pasted full URL).
 */
export function normalizeWebhookToken(raw: string): string {
  let token = decodeURIComponent(raw).trim()
  const fromUrl = token.match(/\/api\/automations\/webhook\/([^/?#]+)/)
  if (fromUrl) token = fromUrl[1]
  return token
}

function tokenFromRow(row: Automation): string | null {
  const cfg = row.trigger_config as WebhookTriggerConfig | null
  const t = cfg?.webhook_token
  return typeof t === 'string' && t.trim() ? t.trim() : null
}

/**
 * Find a webhook automation by its URL token. Tries JSON-path equality
 * first, then falls back to an in-memory scan (few webhook automations
 * per deployment).
 */
export async function findAutomationByWebhookToken(
  db: SupabaseClient,
  rawToken: string,
): Promise<Automation | null> {
  const token = normalizeWebhookToken(rawToken)
  if (!token) return null

  const { data: byPath, error: pathErr } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'webhook_received')
    .filter('trigger_config->>webhook_token', 'eq', token)
    .maybeSingle()

  if (pathErr) {
    console.error('[automations/webhook] JSON path lookup failed:', pathErr)
  } else if (byPath) {
    return byPath as Automation
  }

  const { data: byContains, error: containsErr } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'webhook_received')
    .contains('trigger_config', { webhook_token: token })
    .maybeSingle()

  if (containsErr) {
    console.error('[automations/webhook] contains lookup failed:', containsErr)
  } else if (byContains) {
    return byContains as Automation
  }

  const { data: rows, error: listErr } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'webhook_received')

  if (listErr) {
    console.error('[automations/webhook] list fallback failed:', listErr)
    return null
  }

  return (
    ((rows as Automation[] | null) ?? []).find((row) => tokenFromRow(row) === token) ??
    null
  )
}
