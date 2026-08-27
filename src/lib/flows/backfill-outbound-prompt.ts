import type { SupabaseClient } from '@supabase/supabase-js'

import {
  buildTemplateMessageSnapshot,
  templateDisplayPayload,
} from '@/lib/inbox/template-message-display'
import { buildSendTimeParamsFromVariables } from '@/lib/flows/template-send-params'
import { interpolateTemplateString } from '@/lib/flows/template-interpolate'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { insertOutboundMessage } from '@/lib/whatsapp/persist-outbound-message'
import type { FlowNodeRow, FlowRunRow } from './types'

type AdminClient = SupabaseClient

interface OutboundSnapshot {
  sender_type: 'bot'
  content_type: string
  content_text: string | null
  template_name?: string | null
  content_payload?: Record<string, unknown> | null
}

async function resolveRunVars(
  db: AdminClient,
  run: Pick<FlowRunRow, 'vars' | 'contact_id'>,
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

async function snapshotFromSendTemplateNode(
  db: AdminClient,
  accountId: string,
  node: FlowNodeRow,
  vars: Record<string, unknown>,
): Promise<OutboundSnapshot | null> {
  const cfg = node.config as {
    template_name?: string
    language?: string
    variables?: Record<string, string>
  }
  if (!cfg.template_name) return null

  const lang = cfg.language ?? 'en_US'
  const interpolate = (raw: string) => interpolateTemplateString(raw, vars)
  const messageParams = buildSendTimeParamsFromVariables(cfg.variables, interpolate)
  const bodyParams = messageParams.body ?? []

  const { data: templateRowRaw } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', cfg.template_name)
    .eq('language', lang)
    .maybeSingle()
  const templateRow =
    templateRowRaw && isMessageTemplate(templateRowRaw) ? templateRowRaw : null

  let content_text: string | null = null
  const body = templateRow?.body_text?.trim()
  if (body) {
    content_text = body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
      const idx = Number(raw) - 1
      return bodyParams[idx] ?? `{{${raw}}}`
    })
  }

  return {
    sender_type: 'bot',
    content_type: 'template',
    content_text,
    template_name: cfg.template_name,
    content_payload: templateRow
      ? templateDisplayPayload(
          buildTemplateMessageSnapshot(templateRow, {
            headerMediaUrl: messageParams.headerMediaUrl,
            headerText: messageParams.headerText,
            buttonParams: messageParams.buttonParams,
          }),
        )
      : null,
  }
}

function snapshotFromSendButtonsNode(
  node: FlowNodeRow,
  vars: Record<string, unknown>,
): OutboundSnapshot | null {
  const cfg = node.config as { text?: string }
  if (!cfg.text?.trim()) return null
  return {
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: interpolateTemplateString(cfg.text, vars),
  }
}

function snapshotFromEventPayload(
  payload: Record<string, unknown>,
): OutboundSnapshot | null {
  const content_text =
    typeof payload.content_text === 'string' ? payload.content_text : null
  const template_name =
    typeof payload.template_name === 'string' ? payload.template_name : null
  const node_type = String(payload.node_type ?? '')

  if (node_type === 'send_template' || template_name) {
    return {
      sender_type: 'bot',
      content_type: 'template',
      content_text,
      template_name,
      content_payload:
        payload.content_payload && typeof payload.content_payload === 'object'
          ? (payload.content_payload as Record<string, unknown>)
          : null,
    }
  }

  if (node_type === 'send_buttons' || node_type === 'send_list') {
    return {
      sender_type: 'bot',
      content_type: 'interactive',
      content_text,
    }
  }

  if (content_text) {
    return {
      sender_type: 'bot',
      content_type: 'text',
      content_text,
    }
  }

  return null
}

async function snapshotFromFlowRun(
  db: AdminClient,
  accountId: string,
  run: FlowRunRow,
  metaMessageId: string,
): Promise<OutboundSnapshot | null> {
  const { data: events } = await db
    .from('flow_run_events')
    .select('payload, node_key')
    .eq('flow_run_id', run.id)
    .eq('event_type', 'message_sent')
    .order('created_at', { ascending: false })

  for (const row of events ?? []) {
    const payload = (row as { payload?: Record<string, unknown> }).payload ?? {}
    if (metaMessageId !== '__repair__' && payload.whatsapp_message_id !== metaMessageId) {
      continue
    }
    const fromEvent = snapshotFromEventPayload(payload)
    if (fromEvent) return fromEvent
  }

  const { data: nodes } = await db
    .from('flow_nodes')
    .select('*')
    .eq('flow_id', run.flow_id)

  const vars = await resolveRunVars(db, run)
  for (const node of (nodes as FlowNodeRow[] | null) ?? []) {
    if (node.node_type === 'send_template') {
      const snap = await snapshotFromSendTemplateNode(db, accountId, node, vars)
      if (snap) return snap
    }
    if (node.node_type === 'send_buttons' || node.node_type === 'send_list') {
      const snap = snapshotFromSendButtonsNode(node, vars)
      if (snap) return snap
    }
  }

  return null
}

/**
 * When Meta delivered an outbound automation prompt but our DB row is
 * missing, reconstruct it from flow history so the inbox thread matches
 * what the customer replied to.
 */
export async function backfillMissingOutboundPrompt(args: {
  db: AdminClient
  accountId: string
  contactId: string
  conversationId: string
  metaMessageId: string
  createdAt?: string
}): Promise<string | null> {
  const { data: existingInThread } = await args.db
    .from('messages')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .eq('message_id', args.metaMessageId)
    .maybeSingle()
  if (existingInThread?.id) return existingInThread.id

  const { data: existingAnywhere } = await args.db
    .from('messages')
    .select('id, conversation_id')
    .eq('message_id', args.metaMessageId)
    .maybeSingle()

  if (existingAnywhere?.id) {
    const { data: sourceConv } = await args.db
      .from('conversations')
      .select('contact_id')
      .eq('id', existingAnywhere.conversation_id)
      .maybeSingle()
    if (sourceConv?.contact_id === args.contactId) {
      await args.db
        .from('messages')
        .update({ conversation_id: args.conversationId })
        .eq('id', existingAnywhere.id)
      return existingAnywhere.id
    }
  }

  const { data: runs } = await args.db
    .from('flow_runs')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .order('started_at', { ascending: false })
    .limit(8)

  let snapshot: OutboundSnapshot | null = null
  for (const run of (runs as FlowRunRow[] | null) ?? []) {
    snapshot = await snapshotFromFlowRun(
      args.db,
      args.accountId,
      run,
      args.metaMessageId,
    )
    if (snapshot) break
  }

  if (!snapshot) return null

  try {
    await insertOutboundMessage(args.db, {
      conversation_id: args.conversationId,
      sender_type: snapshot.sender_type,
      content_type: snapshot.content_type,
      content_text: snapshot.content_text,
      template_name: snapshot.template_name ?? null,
      content_payload: snapshot.content_payload ?? null,
      message_id: args.metaMessageId,
      status: 'sent',
      ...(args.createdAt ? { created_at: args.createdAt } : {}),
    })
  } catch (err) {
    console.error('[flows] backfill outbound prompt failed:', err)
    return null
  }

  const { data: inserted } = await args.db
    .from('messages')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .eq('message_id', args.metaMessageId)
    .maybeSingle()

  return inserted?.id ?? null
}

/**
 * Repair a conversation thread that is missing a recent flow/campaign
 * outbound bubble (common when Meta accepted the send but persistence
 * failed). Safe to call on every thread open — no-ops when nothing
 * matches.
 */
export async function repairMissingFlowPromptForConversation(args: {
  db: AdminClient
  accountId: string
  conversationId: string
  contactId: string
}): Promise<string | null> {
  const { data: existingBot } = await args.db
    .from('messages')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .in('sender_type', ['bot', 'agent'])
    .limit(1)
    .maybeSingle()
  if (existingBot?.id) return null

  const { data: customerMsgs } = await args.db
    .from('messages')
    .select('created_at, interactive_reply_id')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: true })
    .limit(1)
  if (!customerMsgs?.length) return null

  const firstCustomerAt = customerMsgs[0]?.created_at as string | undefined
  const promptCreatedAt = firstCustomerAt
    ? new Date(new Date(firstCustomerAt).getTime() - 1000).toISOString()
    : undefined

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: runs } = await args.db
    .from('flow_runs')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(8)

  for (const run of (runs as FlowRunRow[] | null) ?? []) {
    const { data: events } = await args.db
      .from('flow_run_events')
      .select('payload')
      .eq('flow_run_id', run.id)
      .eq('event_type', 'message_sent')
      .order('created_at', { ascending: false })

    for (const row of events ?? []) {
      const payload = (row as { payload?: Record<string, unknown> }).payload ?? {}
      const metaMessageId =
        typeof payload.whatsapp_message_id === 'string'
          ? payload.whatsapp_message_id
          : null
      if (!metaMessageId) continue

      const id = await backfillMissingOutboundPrompt({
        db: args.db,
        accountId: args.accountId,
        contactId: args.contactId,
        conversationId: args.conversationId,
        metaMessageId,
        createdAt: promptCreatedAt,
      })
      if (id) return id
    }

    const snapshot = await snapshotFromFlowRun(
      args.db,
      args.accountId,
      run,
      '__repair__',
    )
    if (!snapshot) continue

    try {
      await insertOutboundMessage(args.db, {
        conversation_id: args.conversationId,
        sender_type: snapshot.sender_type,
        content_type: snapshot.content_type,
        content_text: snapshot.content_text,
        template_name: snapshot.template_name ?? null,
        content_payload: snapshot.content_payload ?? null,
        status: 'sent',
        ...(promptCreatedAt ? { created_at: promptCreatedAt } : {}),
      })
    } catch (err) {
      console.error('[flows] repair outbound prompt failed:', err)
      continue
    }

    const { data: inserted } = await args.db
      .from('messages')
      .select('id')
      .eq('conversation_id', args.conversationId)
      .in('sender_type', ['bot'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (inserted?.id) return inserted.id
  }

  return null
}
