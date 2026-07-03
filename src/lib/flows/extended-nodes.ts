/**
 * Automation-parity node executors for the flows engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { FlowNodeRow, FlowRunRow } from './types'
import { engineSendTemplate } from '@/lib/automations/meta-send'

type AdminClient = SupabaseClient

export interface SendTemplateNodeConfig {
  template_name: string
  language?: string
  variables?: Record<string, string>
  next_node_key: string
}

export interface WaitNodeConfig {
  amount: number
  unit: 'minutes' | 'hours' | 'days'
  next_node_key: string
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
  pipeline_id: string
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
  | { kind: 'wait'; nextKey: string; runAt: string }
  | { kind: 'error'; message: string }

export function interpolateFlowVars(
  template: string,
  vars: Record<string, unknown>,
  messageText?: string,
): string {
  if (!template) return ''
  return template
    .replace(/\{\{\s*vars\.([\w.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''))
    .replace(/\{\{\s*trigger\.([\w.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''))
    .replace(/\{\{\s*message\.text\s*\}\}/g, () => messageText ?? '')
}

function waitMs(cfg: WaitNodeConfig): number {
  const unitMs =
    cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
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

export async function executeExtendedNode(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  messageText?: string,
): Promise<ExtendedNodeResult> {
  const vars = run.vars ?? {}
  const cfg = node.config as Record<string, unknown>

  try {
    switch (node.node_type) {
      case 'send_template': {
        const c = cfg as unknown as SendTemplateNodeConfig
        if (!c.template_name) throw new Error('template_name required')
        const params = c.variables
          ? Object.keys(c.variables)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => interpolateFlowVars(String(c.variables![k]), vars, messageText))
          : []
        await engineSendTemplate({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          templateName: c.template_name,
          language: c.language,
          params,
        })
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'wait': {
        const c = cfg as unknown as WaitNodeConfig
        const runAt = new Date(Date.now() + waitMs(c)).toISOString()
        return { kind: 'wait', nextKey: c.next_node_key, runAt }
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
        }
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'create_deal': {
        const c = cfg as unknown as CreateDealNodeConfig
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
        return { kind: 'continue', nextKey: c.next_node_key }
      }
      case 'close_conversation': {
        const c = cfg as unknown as CloseConversationNodeConfig
        if (run.conversation_id) {
          await db
            .from('conversations')
            .update({ status: 'closed', updated_at: new Date().toISOString() })
            .eq('id', run.conversation_id)
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
  })
  await db
    .from('flow_runs')
    .update({ status: 'waiting', last_advanced_at: new Date().toISOString() })
    .eq('id', run.id)
}
