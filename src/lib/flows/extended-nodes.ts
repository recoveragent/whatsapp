/**
 * Automation-parity node executors for the flows engine.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  ContactFieldMapping,
  FlowNodeRow,
  FlowRunRow,
  UpdateContactFieldNodeConfig,
} from './types'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { buildSendTimeParamsFromVariables, isDynamicHeaderMediaMapping } from '@/lib/flows/template-send-params'
import { resolveFlowProductImageUrl } from '@/lib/flows/resolve-product-image'
import { interpolateTemplateString } from '@/lib/flows/template-interpolate'
import {
  buildTemplateMessageSnapshot,
  isMediaHeaderType,
  templateDisplayPayload,
} from '@/lib/inbox/template-message-display'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { templateConfigHasQuickReplies } from './template-buttons'
import {
  computeWaitRunAt,
  interpolateFlowVars,
  resolveUpdateContactFieldEntries,
  type WaitNodeConfig,
} from './extended-nodes-shared'

export {
  computeWaitRunAt,
  interpolateFlowVars,
  resolveUpdateContactFieldEntries,
  type WaitNodeConfig,
} from './extended-nodes-shared'

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

export interface SendWebhookNodeConfig {
  url: string
  headers?: Record<string, string>
  body_template?: string
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

async function applyContactFieldUpdate(
  db: AdminClient,
  run: FlowRunRow,
  field: string,
  value: string,
): Promise<void> {
  if (field.startsWith('custom:')) {
    const customFieldId = field.slice('custom:'.length)
    const { data: customField } = await db
      .from('custom_fields')
      .select('id')
      .eq('id', customFieldId)
      .eq('account_id', run.account_id)
      .maybeSingle()
    if (!customField) throw new Error('unknown custom field')
    await db.from('contact_custom_values').upsert(
      {
        contact_id: run.contact_id!,
        custom_field_id: customFieldId,
        value,
      },
      { onConflict: 'contact_id,custom_field_id' },
    )
    return
  }

  await db
    .from('contacts')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', run.contact_id!)
    .eq('account_id', run.account_id)
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

        const lang = c.language ?? 'en_US'
        const { data: templateRowRaw } = await db
          .from('message_templates')
          .select('*')
          .eq('account_id', run.account_id)
          .eq('name', c.template_name)
          .eq('language', lang)
          .maybeSingle()
        const templateRow =
          templateRowRaw && isMessageTemplate(templateRowRaw)
            ? templateRowRaw
            : null
        const shopifyOrderContext =
          typeof vars.order_number === 'string' && vars.order_number.trim() !== ''
        if (isMediaHeaderType(templateRow?.header_type) && shopifyOrderContext) {
          const headerMediaConfig = c.variables?.header_media
          const expectsProductImage =
            !headerMediaConfig?.trim() ||
            isDynamicHeaderMediaMapping(headerMediaConfig)
          if (expectsProductImage) {
            messageParams.headerMediaRequired = true
            if (!messageParams.headerMediaUrl && productImageUrl) {
              messageParams.headerMediaUrl = productImageUrl
            }
          }
        }
        if (!messageParams.defaultUrlButtonSuffix) {
          const trackingSuffix = vars.tracking_url_redirect_suffix
          const statusSuffix = vars.order_status_url_suffix
          if (typeof trackingSuffix === 'string' && trackingSuffix.trim()) {
            messageParams.defaultUrlButtonSuffix = trackingSuffix.trim()
          } else if (typeof statusSuffix === 'string' && statusSuffix.trim()) {
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
        const { data: persisted } = await db
          .from('messages')
          .select('content_text, content_payload, template_name')
          .eq('message_id', whatsapp_message_id)
          .maybeSingle()
        let eventContentText: string | null =
          (persisted as { content_text?: string | null } | null)?.content_text ?? null
        if (!eventContentText && templateRow?.body_text?.trim()) {
          const bodyParams = messageParams.body ?? []
          eventContentText = templateRow.body_text.replace(
            /\{\{(\d+)\}\}/g,
            (_, raw: string) => {
              const idx = Number(raw) - 1
              return bodyParams[idx] ?? `{{${raw}}}`
            },
          )
        }
        await db.from('flow_run_events').insert({
          flow_run_id: run.id,
          event_type: 'message_sent',
          node_key: node.node_key,
          payload: {
            node_type: 'send_template',
            whatsapp_message_id,
            template_name: c.template_name,
            content_text: eventContentText,
            content_payload:
              (persisted as { content_payload?: Record<string, unknown> | null } | null)
                ?.content_payload ??
              (templateRow
                ? templateDisplayPayload(
                    buildTemplateMessageSnapshot(templateRow, {
                      headerMediaUrl: messageParams.headerMediaUrl,
                      headerText: messageParams.headerText,
                      buttonParams: messageParams.buttonParams,
                    }),
                  )
                : null),
          },
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
        const entries = resolveUpdateContactFieldEntries(c)
        if (entries.length === 0) throw new Error('update_contact_field needs at least one field')
        if (!run.contact_id) throw new Error('update_contact_field needs a contact')
        for (const entry of entries) {
          const value = interpolateFlowVars(entry.value, vars, messageText)
          await applyContactFieldUpdate(db, run, entry.field, value)
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
        if (!run.contact_id) {
          return { kind: 'error', message: 'create_deal needs a contact on this flow run' }
        }
        if (!c.pipeline_id?.trim() || !c.stage_id?.trim()) {
          return { kind: 'error', message: 'create_deal needs a sales pipeline and lead stage' }
        }
        if (!c.title?.trim()) {
          return { kind: 'error', message: 'create_deal needs a title' }
        }
        const contactId = run.contact_id
        const { data: acct } = await db
          .from('accounts')
          .select('default_currency')
          .eq('id', run.account_id)
          .maybeSingle()
        const {
          createOrMoveDealForContact,
          resolveCreateDealTitle,
        } = await import('@/lib/deals/create-or-move-deal')
        const title = await resolveCreateDealTitle(db, {
          configuredTitle: interpolateFlowVars(c.title, vars, messageText),
          contactId,
          stageId: c.stage_id,
        })
        await createOrMoveDealForContact(db, {
          accountId: run.account_id,
          userId: run.user_id,
          contactId,
          pipelineId: c.pipeline_id,
          stageId: c.stage_id,
          title,
          value: c.value ?? 0,
          currency: acct?.default_currency ?? 'USD',
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
        const toClose = new Set<string>()
        if (run.conversation_id) toClose.add(run.conversation_id)
        if (run.contact_id) {
          const { data: openRows } = await db
            .from('conversations')
            .select('id')
            .eq('account_id', run.account_id)
            .eq('contact_id', run.contact_id)
            .in('status', ['open', 'pending', 'followup'])
          for (const row of openRows ?? []) {
            toClose.add((row as { id: string }).id)
          }
        }
        if (toClose.size > 0) {
          const { insertConversationStatusMessage } = await import(
            '@/lib/inbox/status-system-message'
          )
          const now = new Date().toISOString()
          for (const conversationId of toClose) {
            await db
              .from('conversations')
              .update({ status: 'closed', updated_at: now })
              .eq('id', conversationId)
            await insertConversationStatusMessage({
              db,
              conversationId,
              status: 'closed',
              actor: { kind: 'flow' },
            })
          }
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
  waitNodeKey: string,
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
    .update({
      status: 'waiting',
      current_node_key: waitNodeKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq('id', run.id)
}
