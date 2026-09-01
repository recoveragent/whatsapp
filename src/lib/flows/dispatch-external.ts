/**
 * Start flows from external triggers (webhook, Shopify, tags, etc.).
 */

import { ensureShopifyContact, ensureConversation } from '@/lib/shopify/ensure-contact'
import {
  buildVarsFromPayload,
  extractByPath,
  normalizePayloadPath,
  resolveWebhookTimeZone,
} from '@/lib/automations/webhook-payload'
import {
  cancelFlowRunsByBookingUid,
  extractBookingUid,
  extractWebhookTriggerEvent,
  isTriggerEventAllowed,
} from '@/lib/flows/booking-lifecycle'
import type { FlowWebhookTriggerConfig } from './webhook-config'
import { supabaseAdmin } from './admin-client'
import { startFlowForExternalEvent } from './engine'
import type { FlowRow } from './types'
import {
  flowMatchesShipmentConfig,
  isShopifyFulfillmentFlowTrigger,
  isShopifyOrderFlowTrigger,
  isWooCommerceOrderFlowTrigger,
  resolveFlowStartNodeKey,
  resolveShipmentStatusKey,
  selectedShipmentStatuses,
  shipmentStatusFilterLabel,
  type FlowTriggerType,
} from './trigger-types'
import {
  attachFlowRunToFulfillmentDispatch,
  claimShopifyFulfillmentFlowDispatch,
  fulfillmentOrderKeyFromVars,
  releaseShopifyFulfillmentFlowDispatch,
} from '@/lib/shopify/fulfillment-flow-dedup'

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

export interface FlowDispatchStarted {
  flow_id: string
  flow_name: string
  flow_run_id?: string
}

export interface FlowDispatchSkipped {
  flow_id: string
  flow_name: string
  reason:
    | 'payment_status_mismatch'
    | 'shipment_status_mismatch'
    | 'no_entry_node'
    | 'no_conversation'
    | 'start_failed'
    | 'duplicate_fulfillment_status'
}

export interface FlowDispatchOutcome {
  started: FlowDispatchStarted[]
  skipped: FlowDispatchSkipped[]
  /** True when no active flows exist for this trigger type. */
  no_active_flows: boolean
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

  if (isShopifyOrderFlowTrigger(input.triggerType) || isWooCommerceOrderFlowTrigger(input.triggerType)) {
    const want = cfg.payment_status as string | undefined
    if (want && want !== 'any') {
      const actual = input.context?.vars?.payment_status
      if (actual !== want) return false
    }
  }

  if (isShopifyFulfillmentFlowTrigger(input.triggerType)) {
    if (!flowMatchesShipmentConfig(cfg, input.context?.vars?.shipment_status)) {
      return false
    }
  }

  return true
}

function orderPaymentMismatchReason(
  flow: FlowRow,
  input: FlowDispatchInput,
): string | null {
  if (
    !isShopifyOrderFlowTrigger(input.triggerType) &&
    !isWooCommerceOrderFlowTrigger(input.triggerType)
  ) {
    return null
  }
  const cfg = flow.trigger_config as Record<string, unknown>
  const want = cfg.payment_status as string | undefined
  if (!want || want === 'any') return null
  const actual = input.context?.vars?.payment_status
  if (actual === want) return null
  return `expected "${want}", got "${actual ?? 'null'}"`
}

function shopifyShipmentMismatchReason(
  flow: FlowRow,
  input: FlowDispatchInput,
): string | null {
  if (!isShopifyFulfillmentFlowTrigger(input.triggerType)) return null
  const cfg = flow.trigger_config as Record<string, unknown>
  if (!flowMatchesShipmentConfig(cfg, input.context?.vars?.shipment_status)) {
    const want = selectedShipmentStatuses(cfg)
      .map((s) => shipmentStatusFilterLabel(s))
      .join(', ') || 'any'
    const actual = resolveShipmentStatusKey(input.context?.vars?.shipment_status)
    return `expected "${want}", got "${shipmentStatusFilterLabel(actual)}"`
  }
  return null
}

/**
 * Fire all active flows matching an external trigger for an account.
 */
export async function runFlowsForTrigger(
  input: FlowDispatchInput,
): Promise<FlowDispatchOutcome> {
  const outcome: FlowDispatchOutcome = {
    started: [],
    skipped: [],
    no_active_flows: false,
  }

  try {
    const db = supabaseAdmin()

    if (input.contactId) {
      const { data: owned } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle()
      if (!owned) return outcome
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

    if (flows.length === 0) {
      outcome.no_active_flows = true
      return outcome
    }

    for (const flow of flows) {
      const paymentMismatch = orderPaymentMismatchReason(flow, input)
      if (paymentMismatch) {
        outcome.skipped.push({
          flow_id: flow.id,
          flow_name: flow.name,
          reason: 'payment_status_mismatch',
        })
        continue
      }

      const shipmentMismatch = shopifyShipmentMismatchReason(flow, input)
      if (shipmentMismatch) {
        outcome.skipped.push({
          flow_id: flow.id,
          flow_name: flow.name,
          reason: 'shipment_status_mismatch',
        })
        continue
      }

      if (!flowMatchesTrigger(flow, input)) continue

      if (isShopifyFulfillmentFlowTrigger(input.triggerType)) {
        const orderKey = fulfillmentOrderKeyFromVars(input.context?.vars)
        const shipmentStatusKey = resolveShipmentStatusKey(
          input.context?.vars?.shipment_status,
        )
        if (orderKey) {
          const claimed = await claimShopifyFulfillmentFlowDispatch({
            db,
            accountId: input.accountId,
            flowId: flow.id,
            orderKey,
            shipmentStatusKey,
          })
          if (!claimed) {
            outcome.skipped.push({
              flow_id: flow.id,
              flow_name: flow.name,
              reason: 'duplicate_fulfillment_status',
            })
            continue
          }
        }
      }

      const startNodeKey = resolveFlowStartNodeKey({
        entry_node_id: flow.entry_node_id,
        trigger_type: flow.trigger_type,
        trigger_config: flow.trigger_config as Record<string, unknown>,
        vars: input.context?.vars,
      })
      if (!startNodeKey) {
        if (isShopifyFulfillmentFlowTrigger(input.triggerType)) {
          const orderKey = fulfillmentOrderKeyFromVars(input.context?.vars)
          if (orderKey) {
            await releaseShopifyFulfillmentFlowDispatch({
              db,
              accountId: input.accountId,
              flowId: flow.id,
              orderKey,
              shipmentStatusKey: resolveShipmentStatusKey(
                input.context?.vars?.shipment_status,
              ),
            })
          }
        }
        outcome.skipped.push({
          flow_id: flow.id,
          flow_name: flow.name,
          reason: 'no_entry_node',
        })
        continue
      }

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
      if (!conversationId || !input.contactId) {
        if (isShopifyFulfillmentFlowTrigger(input.triggerType)) {
          const orderKey = fulfillmentOrderKeyFromVars(input.context?.vars)
          if (orderKey) {
            await releaseShopifyFulfillmentFlowDispatch({
              db,
              accountId: input.accountId,
              flowId: flow.id,
              orderKey,
              shipmentStatusKey: resolveShipmentStatusKey(
                input.context?.vars?.shipment_status,
              ),
            })
          }
        }
        outcome.skipped.push({
          flow_id: flow.id,
          flow_name: flow.name,
          reason: 'no_conversation',
        })
        continue
      }

      const result = await startFlowForExternalEvent({
        flow,
        contactId: input.contactId,
        conversationId,
        startNodeKey,
        initialVars: {
          ...(input.context?.vars ?? {}),
          ...(input.context?.message_text
            ? { message_text: input.context.message_text }
            : {}),
        },
        messageText: input.context?.message_text,
      })

      if (result.ok && result.flow_run_id) {
        if (isShopifyFulfillmentFlowTrigger(input.triggerType)) {
          const orderKey = fulfillmentOrderKeyFromVars(input.context?.vars)
          if (orderKey) {
            await attachFlowRunToFulfillmentDispatch({
              db,
              accountId: input.accountId,
              flowId: flow.id,
              orderKey,
              shipmentStatusKey: resolveShipmentStatusKey(
                input.context?.vars?.shipment_status,
              ),
              flowRunId: result.flow_run_id,
            })
          }
        }
        outcome.started.push({
          flow_id: flow.id,
          flow_name: flow.name,
          flow_run_id: result.flow_run_id,
        })
      } else {
        if (isShopifyFulfillmentFlowTrigger(input.triggerType)) {
          const orderKey = fulfillmentOrderKeyFromVars(input.context?.vars)
          if (orderKey) {
            await releaseShopifyFulfillmentFlowDispatch({
              db,
              accountId: input.accountId,
              flowId: flow.id,
              orderKey,
              shipmentStatusKey: resolveShipmentStatusKey(
                input.context?.vars?.shipment_status,
              ),
            })
          }
        }
        outcome.skipped.push({
          flow_id: flow.id,
          flow_name: flow.name,
          reason: 'start_failed',
        })
      }
    }
  } catch (err) {
    console.error('[flows] external dispatch failed:', err)
  }

  return outcome
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

  const triggerEvent = extractWebhookTriggerEvent(payload)
  const bookingUid = extractBookingUid(payload)

  // Tear down reminder waits on cancel/reschedule before allow-list checks
  // so a shared Cal.com webhook URL still clears pending runs.
  if (
    bookingUid &&
    (triggerEvent === 'BOOKING_CANCELLED' ||
      triggerEvent === 'BOOKING_RESCHEDULED')
  ) {
    await cancelFlowRunsByBookingUid(db, flow.account_id, bookingUid)
  }

  if (flow.status !== 'active') {
    return {
      ok: true,
      status: 200,
      flow_id: flow.id,
      error: 'Flow is not active — payload stored for testing',
    }
  }

  if (!isTriggerEventAllowed(triggerEvent, cfg.allowed_trigger_events)) {
    return {
      ok: true,
      status: 200,
      flow_id: flow.id,
      error: `Payload stored; triggerEvent "${triggerEvent}" not in allowed_trigger_events — flow not started`,
    }
  }

  // Cancel only — do not start a new run (reschedule falls through to restart).
  if (triggerEvent === 'BOOKING_CANCELLED') {
    return {
      ok: true,
      status: 200,
      flow_id: flow.id,
      error: bookingUid
        ? 'Booking cancelled — pending reminder runs cleared'
        : 'Booking cancelled — no booking uid in payload',
    }
  }

  const phoneRaw = extractByPath(payload, cfg.phone_path)
  const phone = phoneRaw != null ? String(phoneRaw).trim() : ''
  if (!phone) {
    // 200 so external systems (e.g. Cal.com ping) don't mark the webhook
    // failed — payload is already stored for path mapping in the UI.
    return {
      ok: true,
      status: 200,
      flow_id: flow.id,
      error: `Payload stored; phone not found at path "${normalizePayloadPath(cfg.phone_path)}" — flow not started`,
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

  const vars = buildVarsFromPayload(payload, cfg.variable_mappings ?? {}, {
    timeZone: resolveWebhookTimeZone(payload, cfg.timezone_path),
  })
  vars.phone = contact.phone
  if (name) vars.name = name
  if (bookingUid && vars.booking_uid == null) {
    vars.booking_uid = bookingUid
  }

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
