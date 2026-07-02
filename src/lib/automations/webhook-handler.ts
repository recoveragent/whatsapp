import type { Automation, WebhookTriggerConfig } from '@/types'
import { ensureShopifyContact, ensureConversation } from '@/lib/shopify/ensure-contact'
import { supabaseAdmin } from './admin-client'
import { runSingleAutomation } from './engine'
import {
  buildVarsFromPayload,
  extractByPath,
  normalizePayloadPath,
} from './webhook-payload'
import type { AutomationContext } from './engine'

export interface WebhookHandleResult {
  ok: boolean
  status: number
  error?: string
  automation_id?: string
  contact_id?: string
}

/**
 * Resolve the automation for an inbound webhook token and optionally
 * fire it. Always stores the last received payload for the test UI.
 */
export async function handleInboundWebhook(
  token: string,
  payload: unknown,
): Promise<WebhookHandleResult> {
  if (!token?.trim()) {
    return { ok: false, status: 400, error: 'Missing webhook token' }
  }

  const db = supabaseAdmin()
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'webhook_received')
    .contains('trigger_config', { webhook_token: token })
    .maybeSingle()

  if (error) {
    console.error('[automations/webhook] lookup failed:', error)
    return { ok: false, status: 500, error: 'Lookup failed' }
  }
  if (!automation) {
    return { ok: false, status: 404, error: 'Webhook not found' }
  }

  const row = automation as Automation
  const cfg = row.trigger_config as WebhookTriggerConfig
  const now = new Date().toISOString()

  // Persist last payload for the builder "check received" UI.
  await db
    .from('automations')
    .update({
      trigger_config: {
        ...cfg,
        last_received_payload: payload,
        last_received_at: now,
      },
    })
    .eq('id', row.id)

  if (!row.is_active) {
    return {
      ok: true,
      status: 200,
      automation_id: row.id,
      error: 'Automation is inactive — payload stored for testing',
    }
  }

  const phoneRaw = extractByPath(payload, cfg.phone_path)
  const phone = phoneRaw != null ? String(phoneRaw).trim() : ''
  if (!phone) {
    return {
      ok: false,
      status: 422,
      error: `Phone not found at path "${normalizePayloadPath(cfg.phone_path)}"`,
      automation_id: row.id,
    }
  }

  const namePath = cfg.name_path?.trim()
  const emailPath = cfg.email_path?.trim()
  const nameRaw = namePath ? extractByPath(payload, namePath) : undefined
  const emailRaw = emailPath ? extractByPath(payload, emailPath) : undefined
  const name = nameRaw != null ? String(nameRaw).trim() : ''
  const email = emailRaw != null ? String(emailRaw).trim() : ''

  const contact = await ensureShopifyContact(
    db,
    row.account_id,
    row.user_id,
    phone,
    name || phone,
  )
  if (!contact) {
    return {
      ok: false,
      status: 422,
      error: 'Could not resolve contact from phone',
      automation_id: row.id,
    }
  }

  if (email) {
    await db
      .from('contacts')
      .update({ email, updated_at: now })
      .eq('id', contact.id)
      .eq('account_id', row.account_id)
  }

  const conversation = await ensureConversation(
    db,
    row.account_id,
    row.user_id,
    contact.id,
  )

  const vars = buildVarsFromPayload(payload, cfg.variable_mappings ?? {})
  if (name) vars.name = name
  if (email) vars.email = email
  vars.phone = contact.phone

  const context: AutomationContext = {
    conversation_id: conversation?.id,
    vars,
  }

  await runSingleAutomation({
    automation: row,
    contactId: contact.id,
    context,
    triggerEvent: 'webhook_received',
  })

  return {
    ok: true,
    status: 200,
    automation_id: row.id,
    contact_id: contact.id,
  }
}
