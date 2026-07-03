/**
 * Start flows from external triggers (webhook, Shopify, tags, etc.).
 */

import { ensureShopifyContact, ensureConversation } from '@/lib/shopify/ensure-contact'
import {
  buildVarsFromPayload,
  extractByPath,
  normalizePayloadPath,
} from '@/lib/automations/webhook-payload'
import type { FlowWebhookTriggerConfig } from './webhook-config'
import { supabaseAdmin } from './admin-client'
import { startFlowForExternalEvent } from './engine'
import type { FlowRow } from './types'
import type { FlowTriggerType } from './trigger-types'

export interface FlowDispatchContext {
  message_text?: string
  vars?: Record<string, unknown>
  tag_id?: string
  agent_id?: string
  conversation_id?: string
}

export interface FlowDispatchInput {
  accountId: string
  triggerType: FlowTriggerType
  contactId: string
  conversationId?: string
  context?: FlowDispatchContext
  /** When set, only this flow is considered (webhook token lookup). */
  flowId?: string
}

function flowMatchesTrigger(
  flow: FlowRow,
  input: FlowDispatchInput,
): boolean {
  if (flow.trigger_type !== input.triggerType) return false
  const cfg = flow.trigger_config as Record<string, unknown>

  if (input.triggerType === 'tag_added') {
    const want = cfg.tag_id as string | undefined
    if (want && input.context?.tag_id !== want) return false
  }

  if (input.triggerType === 'time_based') {
    const schedule = cfg.schedule as string | undefined
    if (!schedule) return false
    // Simple HH:mm match for v1; cron expressions can be added later.
    if (/^\d{1,2}:\d{2}$/.test(schedule)) {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      if (`${hh}:${mm}` !== schedule) return false
    }
  }

  return true
}

/**
 * Fire all active flows matching an external trigger for an account.
 */
export async function runFlowsForTrigger(input: FlowDispatchInput): Promise<void> {
  try {
    const db = supabaseAdmin()

    if (input.contactId) {
      const { data: owned } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle()
      if (!owned) return
    }

    let flows: FlowRow[] = []

    if (input.flowId) {
      const { data } = await db
        .from('flows')
        .select('*')
        .eq('id', input.flowId)
        .eq('account_id', input.accountId)
        .eq('status', 'active')
        .maybeSingle()
      if (data) flows = [data as FlowRow]
    } else {
      const { data } = await db
        .from('flows')
        .select('*')
        .eq('account_id', input.accountId)
        .eq('status', 'active')
        .eq('trigger_type', input.triggerType)
      flows = (data as FlowRow[] | null) ?? []
    }

    for (const flow of flows) {
      if (!flowMatchesTrigger(flow, input)) continue
      if (!flow.entry_node_id) continue

      let conversationId = input.conversationId
      if (!conversationId && input.contactId) {
        const conv = await ensureConversation(
          db,
          input.accountId,
          flow.user_id,
          input.contactId,
        )
        conversationId = conv?.id
      }
      if (!conversationId || !input.contactId) continue

      await startFlowForExternalEvent({
        flow,
        contactId: input.contactId,
        conversationId,
        initialVars: {
          ...(input.context?.vars ?? {}),
          ...(input.context?.message_text
            ? { message_text: input.context.message_text }
            : {}),
        },
        messageText: input.context?.message_text,
      })
    }
  } catch (err) {
    console.error('[flows] external dispatch failed:', err)
  }
}

/**
 * Handle inbound webhook POST for a flow (single flow identified by token).
 */
export async function handleFlowInboundWebhook(
  token: string,
  payload: unknown,
): Promise<{ ok: boolean; status: number; error?: string; flow_id?: string }> {
  const db = supabaseAdmin()
  const { findFlowByWebhookToken } = await import('./webhook-lookup')
  const flow = await findFlowByWebhookToken(db, token)
  if (!flow) {
    return { ok: false, status: 404, error: 'Flow webhook not found' }
  }

  const cfg = flow.trigger_config as unknown as FlowWebhookTriggerConfig
  const now = new Date().toISOString()

  await db
    .from('flows')
    .update({
      trigger_config: {
        ...cfg,
        last_received_payload: payload,
        last_received_at: now,
      },
    })
    .eq('id', flow.id)

  if (flow.status !== 'active') {
    return {
      ok: true,
      status: 200,
      flow_id: flow.id,
      error: 'Flow is not active — payload stored for testing',
    }
  }

  const phoneRaw = extractByPath(payload, cfg.phone_path)
  const phone = phoneRaw != null ? String(phoneRaw).trim() : ''
  if (!phone) {
    return {
      ok: false,
      status: 422,
      error: `Phone not found at path "${normalizePayloadPath(cfg.phone_path)}"`,
      flow_id: flow.id,
    }
  }

  const namePath = cfg.name_path?.trim()
  const nameRaw = namePath ? extractByPath(payload, namePath) : undefined
  const name = nameRaw != null ? String(nameRaw).trim() : ''

  const contact = await ensureShopifyContact(
    db,
    flow.account_id,
    flow.user_id,
    phone,
    name || phone,
  )
  if (!contact) {
    return { ok: false, status: 422, error: 'Could not resolve contact', flow_id: flow.id }
  }

  const conversation = await ensureConversation(
    db,
    flow.account_id,
    flow.user_id,
    contact.id,
  )
  if (!conversation) {
    return { ok: false, status: 422, error: 'Could not resolve conversation', flow_id: flow.id }
  }

  const vars = buildVarsFromPayload(payload, cfg.variable_mappings ?? {})
  vars.phone = contact.phone
  if (name) vars.name = name

  await runFlowsForTrigger({
    accountId: flow.account_id,
    triggerType: 'webhook_received',
    contactId: contact.id,
    conversationId: conversation.id,
    flowId: flow.id,
    context: { vars },
  })

  return { ok: true, status: 200, flow_id: flow.id }
}

/**
 * Fire time-based flows whose schedule matches the current minute.
 * Requires `trigger_config.tag_id` — runs once per contact with that tag.
 */
export async function runTimeBasedFlowTriggers(): Promise<number> {
  const db = supabaseAdmin()
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const currentSlot = `${hh}:${mm}`

  const { data: flows } = await db
    .from('flows')
    .select('*')
    .eq('status', 'active')
    .eq('trigger_type', 'time_based')

  let started = 0
  for (const flow of (flows as FlowRow[] | null) ?? []) {
    const cfg = flow.trigger_config as { schedule?: string; tag_id?: string }
    if (!cfg.schedule || cfg.schedule !== currentSlot) continue
    if (!cfg.tag_id || !flow.entry_node_id) continue

    const { data: tagged } = await db
      .from('contact_tags')
      .select('contact_id')
      .eq('tag_id', cfg.tag_id)

    for (const row of tagged ?? []) {
      const contactId = (row as { contact_id: string }).contact_id
      await runFlowsForTrigger({
        accountId: flow.account_id,
        triggerType: 'time_based',
        contactId,
        flowId: flow.id,
      })
      started += 1
    }
  }
  return started
}
