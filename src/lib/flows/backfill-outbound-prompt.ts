import type { SupabaseClient } from '@supabase/supabase-js'

import {
  buildTemplateMessageSnapshot,
  templateDisplayPayload,
} from '@/lib/inbox/template-message-display'
import { buildSendTimeParamsFromVariables } from '@/lib/flows/template-send-params'
import { interpolateTemplateString } from '@/lib/flows/template-interpolate'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { insertOutboundMessage, isMetaSentDbInsertFailed } from '@/lib/whatsapp/persist-outbound-message'
import type { AutomationLogStepResult, AutomationStep } from '@/types'
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
      // Parent bubble already persisted on the canonical thread — do not
      // move rows across conversations (that split flow runs from inbox).
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

const META_WAMID_FROM_AUTOMATION_LOG =
  /(?:template )?sent via Meta \(([^)]+)\)/

async function snapshotFromAutomationStep(
  db: AdminClient,
  accountId: string,
  step: AutomationStep,
  vars: Record<string, unknown>,
): Promise<OutboundSnapshot | null> {
  const interpolate = (raw: string) => interpolateTemplateString(raw, vars)

  if (step.step_type === 'send_message') {
    const cfg = step.step_config as { text?: string }
    if (!cfg.text?.trim()) return null
    return {
      sender_type: 'bot',
      content_type: 'text',
      content_text: interpolate(cfg.text),
    }
  }

  if (step.step_type === 'send_template') {
    const cfg = step.step_config as {
      template_name?: string
      language?: string
      variables?: Record<string, string>
    }
    if (!cfg.template_name) return null

    const lang = cfg.language ?? 'en_US'
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

  return null
}

async function repairMissingAutomationOutbound(args: {
  db: AdminClient
  accountId: string
  conversationId: string
  contactId: string
  promptCreatedAt?: string
}): Promise<string | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: logs } = await args.db
    .from('automation_logs')
    .select('id, automation_id, steps_executed, created_at')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(8)

  if (!logs?.length) return null

  const vars = await resolveRunVars(args.db, { vars: {}, contact_id: args.contactId })

  for (const log of logs) {
    const stepsExecuted =
      (log.steps_executed as AutomationLogStepResult[] | undefined) ?? []

    for (const result of stepsExecuted) {
      if (
        result.step_type !== 'send_message' &&
        result.step_type !== 'send_template'
      ) {
        continue
      }

      const sentToMeta =
        result.status === 'success' ||
        (result.status === 'failed' &&
          !!result.detail &&
          isMetaSentDbInsertFailed(result.detail))
      if (!sentToMeta) continue

      const wamidMatch = result.detail?.match(META_WAMID_FROM_AUTOMATION_LOG)
      const metaMessageId = wamidMatch?.[1] ?? null

      if (metaMessageId) {
        const id = await backfillMissingOutboundPrompt({
          db: args.db,
          accountId: args.accountId,
          contactId: args.contactId,
          conversationId: args.conversationId,
          metaMessageId,
          createdAt: args.promptCreatedAt,
        })
        if (id) return id
      }

      const { data: stepRow } = await args.db
        .from('automation_steps')
        .select('*')
        .eq('id', result.step_id)
        .maybeSingle()
      if (!stepRow) continue

      const snapshot = await snapshotFromAutomationStep(
        args.db,
        args.accountId,
        stepRow as AutomationStep,
        vars,
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
          message_id: metaMessageId,
          status: 'sent',
          ...(args.promptCreatedAt ? { created_at: args.promptCreatedAt } : {}),
        })
      } catch (err) {
        console.error('[automations] repair outbound message failed:', err)
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
  }

  return null
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

  const { data: customerMsgs } = await args.db
    .from('messages')
    .select('created_at, interactive_reply_id')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: true })
    .limit(1)

  const firstCustomerAt = customerMsgs?.[0]?.created_at as string | undefined
  const promptCreatedAtBeforeReply = firstCustomerAt
    ? new Date(new Date(firstCustomerAt).getTime() - 1000).toISOString()
    : undefined

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  let runsQuery = args.db
    .from('flow_runs')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(8)

  const { data: runsForConv } = await runsQuery.eq(
    'conversation_id',
    args.conversationId,
  )
  let runs = (runsForConv as FlowRunRow[] | null) ?? []

  // Runs whose conversation shell was deleted (ON DELETE SET NULL) still
  // hold message_sent events we need to backfill onto the canonical thread.
  if (runs.length === 0) {
    const { data: orphaned } = await args.db
      .from('flow_runs')
      .select('*')
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .is('conversation_id', null)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(8)
    runs = (orphaned as FlowRunRow[] | null) ?? []
  }

  for (const run of runs) {
    const { data: events } = await args.db
      .from('flow_run_events')
      .select('payload, created_at')
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

      const eventCreatedAt = (row as { created_at?: string }).created_at
      const createdAt =
        promptCreatedAtBeforeReply ??
        eventCreatedAt ??
        (run.started_at as string | undefined)

      const id = await backfillMissingOutboundPrompt({
        db: args.db,
        accountId: args.accountId,
        contactId: args.contactId,
        conversationId: args.conversationId,
        metaMessageId,
        createdAt,
      })
      if (id) return id
    }

    if (existingBot?.id) continue

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
        ...(promptCreatedAtBeforeReply ? { created_at: promptCreatedAtBeforeReply } : {}),
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

  if (existingBot?.id || !customerMsgs?.length) return null

  return repairMissingAutomationOutbound({
    db: args.db,
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    promptCreatedAt: promptCreatedAtBeforeReply,
  })
}

interface FlowRunJoinRow {
  id: string
  account_id: string
  contact_id: string | null
  conversation_id: string | null
  flow_id: string
  user_id: string
}

export interface BulkFlowOutboundRepairResult {
  scanned_events: number
  missing_wamids: number
  backfilled: number
  relinked_runs: number
  skipped_existing: number
  skipped_no_contact: number
  failed: number
  details: Array<{
    flow_run_id: string
    wamid: string
    contact_id: string | null
    outcome: 'backfilled' | 'skipped_existing' | 'skipped_no_contact' | 'failed'
    message_id?: string
    error?: string
  }>
}

/**
 * One-shot repair for every flow `message_sent` whose WAMID never
 * landed in `messages` (Meta accepted send, DB persist failed).
 */
export async function bulkRepairMissingFlowOutboundMessages(args: {
  db: AdminClient
  /** How far back to scan flow_run_events. Default 90 days. */
  lookbackDays?: number
  dryRun?: boolean
}): Promise<BulkFlowOutboundRepairResult> {
  const lookbackDays = args.lookbackDays ?? 90
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()
  const result: BulkFlowOutboundRepairResult = {
    scanned_events: 0,
    missing_wamids: 0,
    backfilled: 0,
    relinked_runs: 0,
    skipped_existing: 0,
    skipped_no_contact: 0,
    failed: 0,
    details: [],
  }

  const { ensureConversationForContact } = await import('@/lib/inbox/ensure-conversation')

  const pageSize = 500
  let offset = 0
  const seenWamids = new Set<string>()

  for (;;) {
    const { data: events, error } = await args.db
      .from('flow_run_events')
      .select('payload, created_at, flow_run_id')
      .eq('event_type', 'message_sent')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!events?.length) break

    result.scanned_events += events.length

    type PendingEvent = {
      wamid: string
      flow_run_id: string
      created_at: string | undefined
    }
    const pending: PendingEvent[] = []

    for (const event of events) {
      const payload = (event.payload ?? {}) as Record<string, unknown>
      const wamid =
        typeof payload.whatsapp_message_id === 'string'
          ? payload.whatsapp_message_id.trim()
          : ''
      if (!wamid || seenWamids.has(wamid)) continue
      seenWamids.add(wamid)
      pending.push({
        wamid,
        flow_run_id: event.flow_run_id as string,
        created_at: event.created_at as string | undefined,
      })
    }

    if (pending.length > 0) {
      const wamids = pending.map((p) => p.wamid)
      const { data: existingRows } = await args.db
        .from('messages')
        .select('message_id')
        .in('message_id', wamids)

      const existingSet = new Set(
        (existingRows ?? [])
          .map((r) => (r as { message_id?: string }).message_id)
          .filter(Boolean) as string[],
      )

      const runIds = [...new Set(pending.map((p) => p.flow_run_id))]
      const runById = new Map<string, FlowRunJoinRow>()
      for (let i = 0; i < runIds.length; i += 100) {
        const chunk = runIds.slice(i, i + 100)
        const { data: runs } = await args.db
          .from('flow_runs')
          .select('id, account_id, contact_id, conversation_id, flow_id, user_id')
          .in('id', chunk)
        for (const r of (runs as FlowRunJoinRow[] | null) ?? []) {
          runById.set(r.id, r)
        }
      }

      for (const item of pending) {
        if (existingSet.has(item.wamid)) {
          result.skipped_existing += 1
          continue
        }

        result.missing_wamids += 1
        const run = runById.get(item.flow_run_id)
        if (!run?.contact_id) {
          result.skipped_no_contact += 1
          result.details.push({
            flow_run_id: item.flow_run_id,
            wamid: item.wamid,
            contact_id: run?.contact_id ?? null,
            outcome: 'skipped_no_contact',
          })
          continue
        }

        if (args.dryRun) {
          result.details.push({
            flow_run_id: run.id,
            wamid: item.wamid,
            contact_id: run.contact_id,
            outcome: 'backfilled',
          })
          continue
        }

        try {
          const conv = await ensureConversationForContact(
            args.db,
            run.account_id,
            run.user_id,
            run.contact_id,
          )
          if (!conv?.id) throw new Error('could not resolve conversation')

          if (run.conversation_id !== conv.id) {
            await args.db
              .from('flow_runs')
              .update({ conversation_id: conv.id })
              .eq('id', run.id)
            run.conversation_id = conv.id
            result.relinked_runs += 1
          }

          const messageId = await backfillMissingOutboundPrompt({
            db: args.db,
            accountId: run.account_id,
            contactId: run.contact_id,
            conversationId: conv.id,
            metaMessageId: item.wamid,
            createdAt: item.created_at,
          })

          if (messageId) {
            result.backfilled += 1
            result.details.push({
              flow_run_id: run.id,
              wamid: item.wamid,
              contact_id: run.contact_id,
              outcome: 'backfilled',
              message_id: messageId,
            })
          } else {
            result.failed += 1
            result.details.push({
              flow_run_id: run.id,
              wamid: item.wamid,
              contact_id: run.contact_id,
              outcome: 'failed',
              error: 'backfill returned null',
            })
          }
        } catch (err) {
          result.failed += 1
          result.details.push({
            flow_run_id: run.id,
            wamid: item.wamid,
            contact_id: run.contact_id,
            outcome: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    if (events.length < pageSize) break
    offset += pageSize
  }

  return result
}
