/**
 * Automation-parity node executors for the flows engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { FlowNodeRow, FlowRunRow } from './types'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { buildSendTimeParamsFromVariables } from '@/lib/flows/template-send-params'
import { resolveFlowProductImageUrl } from '@/lib/flows/resolve-product-image'
import { interpolateTemplateString } from '@/lib/flows/template-interpolate'
import { templateConfigHasQuickReplies } from './template-buttons'

type AdminClient = SupabaseClient

export interface SendTemplateNodeConfig {
  template_name: string
  language?: string
  variables?: Record<string, string>
  buttons?: Array<{
    reply_id: string
    title: string
    next_node_key: string
  }>
  next_node_key: string
}

export interface WaitNodeConfig {
  /** Relative delay from now (default). Absolute: wait until a datetime var. */
  mode?: 'delay' | 'until'
  amount: number
  unit: 'minutes' | 'hours' | 'days'
  next_node_key: string
  /** Var key holding an ISO datetime (e.g. meeting_start). Used when mode=until. */
  datetime_var?: string
  /**
   * Minutes relative to datetime_var. Negative = before (e.g. -60 = 1h before).
   * Used when mode=until.
   */
  offset_minutes?: number
}

export interface SendWebhookNodeConfig {
  url: string
  headers?: Record<string, string>
  body_template?: string
  next_node_key: string
}

export interface UpdateContactFieldNodeConfig {
  field: string
  value: string
  next_node_key: string
}

export interface AssignConversationNodeConfig {
  mode: 'specific' | 'round_robin'
  agent_id?: string
  next_node_key: string
}

export interface CreateDealNodeConfig {
  /** Sales pipeline the deal is created in. */
  pipeline_id: string
  /** Lead stage the new deal is placed in (must belong to `pipeline_id`). */
  stage_id: string
  title: string
  value?: number
  next_node_key: string
}

export interface CloseConversationNodeConfig {
  next_node_key: string
}

export type ExtendedNodeResult =
  | { kind: 'continue'; nextKey: string }
  | { kind: 'suspend' }
  | { kind: 'wait'; nextKey: string; runAt: string }
  | { kind: 'error'; message: string }

export function interpolateFlowVars(
  template: string,
  vars: Record<string, unknown>,
  messageText?: string,
): string {
  return interpolateTemplateString(template, vars, messageText)
}

function waitMs(cfg: WaitNodeConfig): number {
  const unitMs =
    cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

/**
 * Compute when a wait node should resume.
 * - mode delay (default): now + amount/unit
 * - mode until: vars[datetime_var] (+ optional offset_minutes)
 *   Prefers `${datetime_var}_iso` when present (raw ISO kept alongside formatted display).
 * Returns null if until-mode datetime is missing/invalid (caller should error).
 * If the computed time is already past, returns now (immediate continue via short wait
 * is handled by caller as continue).
 */
export function computeWaitRunAt(
  cfg: WaitNodeConfig,
  vars: Record<string, unknown>,
  nowMs: number = Date.now(),
): { runAt: string; immediate: boolean } | { error: string } {
  if (cfg.mode === 'until') {
    const key = (cfg.datetime_var ?? '').trim()
    if (!key) return { error: 'datetime_var required when wait mode is until' }
    const raw = vars[`${key}_iso`] ?? vars[key]
    if (raw == null || String(raw).trim() === '') {
      return { error: `datetime var "${key}" is missing` }
    }
    const base = Date.parse(String(raw).trim())
    if (Number.isNaN(base)) {
      return { error: `datetime var "${key}" is not a valid ISO datetime` }
    }
    const offset = Number(cfg.offset_minutes ?? 0)
    const target = base + (Number.isFinite(offset) ? offset : 0) * 60_000
    if (target <= nowMs) {
      return { runAt: new Date(nowMs).toISOString(), immediate: true }
    }
    return { runAt: new Date(target).toISOString(), immediate: false }
  }

  return {
    runAt: new Date(nowMs + waitMs(cfg)).toISOString(),
    immediate: false,
  }
}

const EXTENDED_NODE_TYPES = new Set([
  'send_template',
  'wait',
  'send_webhook',
  'http_fetch',
  'update_contact_field',
  'assign_conversation',
  'create_deal',
  'close_conversation',
])

export function isExtendedNodeType(nodeType: string): boolean {
  return EXTENDED_NODE_TYPES.has(nodeType)
}

async function resolveFlowInterpolationVars(
  db: AdminClient,
  run: FlowRunRow,
): Promise<Record<string, unknown>> {
  const merged = { ...(run.vars ?? {}) }
  if (!run.contact_id) return merged

  const { data } = await db
    .from('contacts')
    .select('name, email, phone, company')
    .eq('id', run.contact_id)
    .maybeSingle()

  if (!data) return merged
  const contact = data as {
    name?: string | null
    email?: string | null
    phone?: string | null
    company?: string | null
  }

  if (contact.name && merged.name === undefined) merged.name = contact.name
  if (contact.phone && merged.phone === undefined) merged.phone = contact.phone
  if (contact.email && merged.email === undefined) merged.email = contact.email
  if (contact.company && merged.company === undefined) merged.company = contact.company

  const fullName = String(contact.name ?? merged.name ?? '').trim()
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (merged.first_name === undefined) merged.first_name = parts[0] ?? ''
  if (merged.last_name === undefined) merged.last_name = parts.slice(1).join(' ')
  if (merged.customer_name === undefined && fullName) merged.customer_name = fullName

  return merged
}

export async function executeExtendedNode(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  messageText?: string,
): Promise<ExtendedNodeResult> {
  const vars = await resolveFlowInterpolationVars(db, run)
  const cfg = node.config as Record<string, unknown>

  try {
    switch (node.node_type) {
      case 'send_template': {
        const c = cfg as unknown as SendTemplateNodeConfig
        if (!c.template_name) throw new Error('template_name required')
        const interpolate = (raw: string) =>
          interpolateFlowVars(raw, vars, messageText)
        const productImageUrl = await resolveFlowProductImageUrl(
          db,
          run.account_id,
          vars,
        )
        if (productImageUrl) {
          vars.product_image = productImageUrl
        }
        const messageParams = buildSendTimeParamsFromVariables(
          c.variables,
          interpolate,
        )
        if (!messageParams.headerMediaUrl && productImageUrl) {
          messageParams.headerMediaUrl = productImageUrl
        }
        if (!messageParams.defaultUrlButtonSuffix) {
          const statusSuffix = vars.order_status_url_suffix
          if (typeof statusSuffix === 'string' && statusSuffix.trim()) {
            messageParams.defaultUrlButtonSuffix = statusSuffix.trim()
          }
        }
        const { whatsapp_message_id } = await engineSendTemplate({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          templateName: c.template_name,
          language: c.language,
          messageParams,
        })
        if (templateConfigHasQuickReplies(c)) {
          const { data: msg } = await db
            .from('messages')
            .select('id')
            .eq('message_id', whatsapp_message_id)
            .maybeSingle()
          await db
            .from('flow_runs')
            .update({
              last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
            })
            .eq('id', run.id)
          return { kind: 'suspend' }
        }
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'wait': {
        const c = cfg as unknown as WaitNodeConfig
        const computed = computeWaitRunAt(c, vars)
        if ('error' in computed) throw new Error(computed.error)
        if (computed.immediate) {
          return { kind: 'continue', nextKey: c.next_node_key }
        }
        return { kind: 'wait', nextKey: c.next_node_key, runAt: computed.runAt }
      }
      case 'send_webhook':
      case 'http_fetch': {
        const c = cfg as unknown as SendWebhookNodeConfig
        if (!c.url) throw new Error('url required')
        const body = c.body_template
          ? interpolateFlowVars(c.body_template, vars, messageText)
          : JSON.stringify({ vars, contact_id: run.contact_id })
        const res = await fetch(c.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(c.headers ?? {}) },
          body,
        })
        if (!res.ok) throw new Error(`webhook returned ${res.status}`)
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'update_contact_field': {
        const c = cfg as unknown as UpdateContactFieldNodeConfig
        const value = interpolateFlowVars(c.value, vars, messageText)
        if (c.field.startsWith('custom:')) {
          const customFieldId = c.field.slice('custom:'.length)
          const { data: field } = await db
            .from('custom_fields')
            .select('id')
            .eq('id', customFieldId)
            .eq('account_id', run.account_id)
            .maybeSingle()
          if (!field) throw new Error('unknown custom field')
          await db.from('contact_custom_values').upsert(
            {
              contact_id: run.contact_id!,
              custom_field_id: customFieldId,
              value,
            },
            { onConflict: 'contact_id,custom_field_id' },
          )
        } else {
          await db
            .from('contacts')
            .update({ [c.field]: value, updated_at: new Date().toISOString() })
            .eq('id', run.contact_id!)
            .eq('account_id', run.account_id)
        }
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'assign_conversation': {
        const c = cfg as unknown as AssignConversationNodeConfig
        let agentId = c.agent_id
        if (c.mode === 'round_robin') {
          const { data: profiles } = await db
            .from('profiles')
            .select('user_id')
            .eq('account_id', run.account_id)
            .limit(1)
          agentId = profiles?.[0]?.user_id
        }
        if (agentId && run.conversation_id) {
          await db
            .from('conversations')
            .update({ assigned_agent_id: agentId })
            .eq('id', run.conversation_id)
          if (run.contact_id) {
            const { dispatchConversationAssigned } = await import(
              '@/lib/crm/dispatch-triggers'
            )
            dispatchConversationAssigned({
              accountId: run.account_id,
              contactId: run.contact_id,
              conversationId: run.conversation_id,
              agentId,
              exceptRunId: run.id,
            })
          }
        }
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'create_deal': {
        const c = cfg as unknown as CreateDealNodeConfig
        if (!c.pipeline_id?.trim() || !c.stage_id?.trim()) {
          return { kind: 'error', message: 'create_deal needs a sales pipeline and lead stage' }
        }
        if (!c.title?.trim()) {
          return { kind: 'error', message: 'create_deal needs a title' }
        }
        const { data: acct } = await db
          .from('accounts')
          .select('default_currency')
          .eq('id', run.account_id)
          .maybeSingle()
        await db.from('deals').insert({
          account_id: run.account_id,
          user_id: run.user_id,
          pipeline_id: c.pipeline_id,
          stage_id: c.stage_id,
          contact_id: run.contact_id,
          title: interpolateFlowVars(c.title, vars, messageText),
          value: c.value ?? 0,
          currency: acct?.default_currency ?? 'USD',
          status: 'open',
        })
        if (run.contact_id && c.stage_id) {
          const { dispatchDealStageChanged } = await import(
            '@/lib/crm/dispatch-triggers'
          )
          dispatchDealStageChanged({
            accountId: run.account_id,
            contactId: run.contact_id,
            stageId: c.stage_id,
            exceptRunId: run.id,
          })
        }
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'close_conversation': {
        const c = cfg as unknown as CloseConversationNodeConfig
        if (run.conversation_id) {
          await db
            .from('conversations')
            .update({ status: 'closed', updated_at: new Date().toISOString() })
            .eq('id', run.conversation_id)
          const { insertConversationStatusMessage } = await import(
            '@/lib/inbox/status-system-message'
          )
          await insertConversationStatusMessage({
            db,
            conversationId: run.conversation_id,
            status: 'closed',
            actor: { kind: 'flow' },
          })
        }
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      default:
        return { kind: 'error', message: `unknown extended node: ${node.node_type}` }
    }
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function enqueueFlowWait(
  db: AdminClient,
  run: FlowRunRow,
  nextNodeKey: string,
  runAt: string,
): Promise<void> {
  await db.from('flow_pending_executions').insert({
    flow_run_id: run.id,
    flow_id: run.flow_id,
    account_id: run.account_id,
    user_id: run.user_id,
    contact_id: run.contact_id,
    conversation_id: run.conversation_id,
    next_node_key: nextNodeKey,
    vars: run.vars ?? {},
    run_at: runAt,
    status: 'pending',
    execution_kind: 'wait',
  })
  await db
    .from('flow_runs')
    .update({ status: 'waiting', last_advanced_at: new Date().toISOString() })
    .eq('id', run.id)
}
