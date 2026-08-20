import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { ensureConversation } from '@/lib/shopify/ensure-contact'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'
import type { MessageTemplate } from '@/types'

import {
  addMinutes,
  callWindowFromCadence,
  nextCallSlot,
} from './business-hours'
import { patchContactLead } from './enroll'
import { inferLeadLanguage, pickTemplateLanguage } from './language'
import { cancelOpenTasks, exitEnrollment } from './pause'
import type {
  Cadence,
  CadenceEnrollment,
  CadenceStep,
  CrmTaskType,
  LeadLanguage,
} from './types'

export const MAX_ENROLLMENTS_PER_TICK = 25
const CLAIM_MS = 2 * 60_000

interface EngineResult {
  processed: number
  sent: number
  tasks: number
  expired: number
  errors: string[]
}

function firstName(name: string | null | undefined, phone: string): string {
  const n = (name ?? '').trim()
  if (!n) return phone
  return n.split(/\s+/)[0] ?? n
}

function fillBodyParams(
  template: MessageTemplate,
  name: string,
  campaign: string,
): string[] {
  const count = extractVariableIndices(template.body_text).length
  if (count <= 0) return []
  const values: string[] = []
  for (let i = 0; i < count; i++) {
    if (i === 0) values.push(name)
    else if (i === 1) values.push(campaign || name)
    else values.push(campaign || name)
  }
  return values
}

async function loadSteps(
  db: SupabaseClient,
  cadenceId: string,
): Promise<CadenceStep[]> {
  const { data } = await db
    .from('cadence_steps')
    .select('*')
    .eq('cadence_id', cadenceId)
    .order('position', { ascending: true })
  return (data as CadenceStep[] | null) ?? []
}

async function advanceEnrollment(args: {
  db: SupabaseClient
  enrollment: CadenceEnrollment
  steps: CadenceStep[]
  justRanPosition: number
  now: Date
}): Promise<void> {
  const next = args.steps.find((s) => s.position > args.justRanPosition)
  if (!next) {
    await args.db
      .from('cadence_enrollments')
      .update({
        status: 'completed',
        completed_at: args.now.toISOString(),
        next_run_at: null,
        claimed_until: null,
        last_error: null,
        current_step_position: args.justRanPosition,
      })
      .eq('id', args.enrollment.id)
    await patchContactLead(args.db, {
      contactId: args.enrollment.contact_id,
      accountId: args.enrollment.account_id,
      patch: { next_action_at: null, next_action_type: 'waiting' },
    })
    return
  }

  const started = new Date(args.enrollment.started_at)
  let runAt = addMinutes(started, next.delay_minutes)
  if (runAt.getTime() < args.now.getTime()) runAt = args.now

  await args.db
    .from('cadence_enrollments')
    .update({
      current_step_position: next.position,
      next_run_at: runAt.toISOString(),
      claimed_until: null,
      last_error: null,
    })
    .eq('id', args.enrollment.id)

  await patchContactLead(args.db, {
    contactId: args.enrollment.contact_id,
    accountId: args.enrollment.account_id,
    patch: {
      next_action_at: runAt.toISOString(),
      next_action_type: next.channel,
    },
  })
}

async function failStep(
  db: SupabaseClient,
  enrollmentId: string,
  message: string,
): Promise<void> {
  await db
    .from('cadence_enrollments')
    .update({
      last_error: message.slice(0, 500),
      claimed_until: null,
    })
    .eq('id', enrollmentId)
}

async function sendTemplateStep(args: {
  db: SupabaseClient
  enrollment: CadenceEnrollment
  step: CadenceStep
  cadence: Cadence
  contact: {
    id: string
    phone: string
    name: string | null
    lead_language: string | null
  }
  campaignName: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const templateName = args.step.template_name?.trim()
  if (!templateName) {
    return {
      ok: false,
      error: `Step ${args.step.position}: pick a WhatsApp template in Settings → Lead cadences`,
    }
  }

  const { data: rows } = await args.db
    .from('message_templates')
    .select('*')
    .eq('account_id', args.enrollment.account_id)
    .eq('name', templateName)
    .eq('status', 'APPROVED')

  const list = (rows as MessageTemplate[] | null) ?? []
  const language = pickTemplateLanguage(
    list,
    inferLeadLanguage(args.contact.lead_language, 'en'),
  )
  const template =
    list.find((r) => (r.language ?? '') === language) ?? list[0] ?? null
  if (!template) {
    return {
      ok: false,
      error: `No APPROVED template named "${templateName}"`,
    }
  }

  const conversation = await ensureConversation(
    args.db,
    args.enrollment.account_id,
    args.enrollment.user_id,
    args.contact.id,
    { createStatus: 'closed' },
  )
  if (!conversation) {
    return { ok: false, error: 'Could not open a conversation for the send' }
  }

  const displayName = firstName(args.contact.name, args.contact.phone)
  const body = fillBodyParams(template, displayName, args.campaignName)
  const headerVars = extractVariableIndices(template.header_content ?? '')
  const headerText = headerVars.length > 0 ? displayName : undefined

  const buttonParams: Record<number, string> = {}
  const buttons = template.buttons ?? []
  buttons.forEach((button, index) => {
    if (button.type === 'URL' && extractVariableIndices(button.url).length > 0) {
      buttonParams[index] = displayName
    }
  })

  try {
    await engineSendTemplate({
      accountId: args.enrollment.account_id,
      userId: args.enrollment.user_id,
      conversationId: conversation.id,
      contactId: args.contact.id,
      templateName: template.name,
      language: template.language ?? language ?? 'en_US',
      params: body,
      messageParams: {
        body,
        headerText,
        buttonParams: Object.keys(buttonParams).length > 0 ? buttonParams : undefined,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'template send failed'
    return { ok: false, error: message }
  }

  await patchContactLead(args.db, {
    contactId: args.contact.id,
    accountId: args.enrollment.account_id,
    patch: { last_touch_at: new Date().toISOString() },
  })

  return { ok: true }
}

async function createTaskStep(args: {
  db: SupabaseClient
  enrollment: CadenceEnrollment
  step: CadenceStep
  cadence: Cadence
  contact: {
    id: string
    phone: string
    name: string | null
    lead_language: string | null
  }
  campaignName: string
  now: Date
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const type: CrmTaskType =
    args.step.channel === 'voice_note_task' ? 'voice_note' : 'call'
  const lang: LeadLanguage = inferLeadLanguage(args.contact.lead_language, 'en')
  const script =
    (lang === 'hi' ? args.step.script_hi : args.step.script_en)?.trim() ||
    args.step.script_en?.trim() ||
    args.step.script_hi?.trim() ||
    null

  const window = callWindowFromCadence(args.cadence)
  const dueAt = nextCallSlot(args.now, window)

  const { data: conversation } = await args.db
    .from('conversations')
    .select('id')
    .eq('account_id', args.enrollment.account_id)
    .eq('contact_id', args.contact.id)
    .maybeSingle()

  const { error } = await args.db.from('crm_tasks').insert({
    account_id: args.enrollment.account_id,
    contact_id: args.contact.id,
    enrollment_id: args.enrollment.id,
    cadence_step_id: args.step.id,
    conversation_id: conversation?.id ?? null,
    type,
    status: 'pending',
    due_at: dueAt.toISOString(),
    script,
    campaign_name: args.campaignName || null,
  })

  if (error && !isUniqueViolation(error)) {
    return { ok: false, error: error.message }
  }

  await patchContactLead(args.db, {
    contactId: args.contact.id,
    accountId: args.enrollment.account_id,
    patch: {
      next_action_at: dueAt.toISOString(),
      next_action_type: type,
    },
  })

  return { ok: true }
}

async function expireIfNeeded(
  db: SupabaseClient,
  enrollment: CadenceEnrollment,
  cadence: Cadence,
  now: Date,
): Promise<boolean> {
  const started = new Date(enrollment.started_at).getTime()
  const days = cadence.expire_after_days || 30
  if (now.getTime() < started + days * 24 * 60 * 60 * 1000) return false

  await exitEnrollment({
    db,
    accountId: enrollment.account_id,
    contactId: enrollment.contact_id,
    reason: 'expired',
    nextLeadStatus: 'expired',
  })
  return true
}

async function processOne(
  db: SupabaseClient,
  enrollment: CadenceEnrollment,
  now: Date,
): Promise<{ sent: boolean; task: boolean; expired: boolean; error?: string }> {
  const { data: cadence } = await db
    .from('cadences')
    .select('*')
    .eq('id', enrollment.cadence_id)
    .maybeSingle()
  if (!cadence) {
    await failStep(db, enrollment.id, 'Cadence was deleted')
    return { sent: false, task: false, expired: false, error: 'cadence missing' }
  }

  if (await expireIfNeeded(db, enrollment, cadence as Cadence, now)) {
    return { sent: false, task: false, expired: true }
  }

  const steps = await loadSteps(db, enrollment.cadence_id)
  const step = steps.find((s) => s.position === enrollment.current_step_position)
  if (!step) {
    await advanceEnrollment({
      db,
      enrollment,
      steps,
      justRanPosition: enrollment.current_step_position,
      now,
    })
    return { sent: false, task: false, expired: false, error: 'step missing' }
  }

  const { data: contact } = await db
    .from('contacts')
    .select('id, phone, name, lead_language')
    .eq('id', enrollment.contact_id)
    .eq('account_id', enrollment.account_id)
    .maybeSingle()
  if (!contact?.phone) {
    await failStep(db, enrollment.id, 'Contact missing')
    return { sent: false, task: false, expired: false, error: 'contact missing' }
  }

  let campaignName = ''
  if (enrollment.lead_source_id) {
    const { data: source } = await db
      .from('lead_sources')
      .select('name')
      .eq('id', enrollment.lead_source_id)
      .maybeSingle()
    campaignName = (source?.name as string | undefined) ?? ''
  }

  if (step.channel === 'wa_template') {
    const result = await sendTemplateStep({
      db,
      enrollment,
      step,
      cadence: cadence as Cadence,
      contact: {
        id: contact.id as string,
        phone: contact.phone as string,
        name: (contact.name as string | null) ?? null,
        lead_language: (contact.lead_language as string | null) ?? null,
      },
      campaignName,
    })
    if (!result.ok) {
      await failStep(db, enrollment.id, result.error)
      return { sent: false, task: false, expired: false, error: result.error }
    }
    await advanceEnrollment({
      db,
      enrollment,
      steps,
      justRanPosition: step.position,
      now,
    })
    return { sent: true, task: false, expired: false }
  }

  const result = await createTaskStep({
    db,
    enrollment,
    step,
    cadence: cadence as Cadence,
    contact: {
      id: contact.id as string,
      phone: contact.phone as string,
      name: (contact.name as string | null) ?? null,
      lead_language: (contact.lead_language as string | null) ?? null,
    },
    campaignName,
    now,
  })
  if (!result.ok) {
    await failStep(db, enrollment.id, result.error)
    return { sent: false, task: false, expired: false, error: result.error }
  }
  await advanceEnrollment({
    db,
    enrollment,
    steps,
    justRanPosition: step.position,
    now,
  })
  return { sent: false, task: true, expired: false }
}

export async function processDueCadences(db: SupabaseClient): Promise<EngineResult> {
  const result: EngineResult = {
    processed: 0,
    sent: 0,
    tasks: 0,
    expired: 0,
    errors: [],
  }
  const now = new Date()
  const nowIso = now.toISOString()

  await db
    .from('crm_tasks')
    .update({ status: 'pending', claimed_by: null, claimed_until: null })
    .eq('status', 'claimed')
    .lt('claimed_until', nowIso)

  const { data: due, error } = await db
    .from('cadence_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(MAX_ENROLLMENTS_PER_TICK)

  if (error) {
    result.errors.push(error.message)
    return result
  }

  const claimUntil = new Date(now.getTime() + CLAIM_MS).toISOString()

  for (const row of (due as CadenceEnrollment[] | null) ?? []) {
    if (row.claimed_until && new Date(row.claimed_until).getTime() > now.getTime()) {
      continue
    }
    const { data: claim } = await db
      .from('cadence_enrollments')
      .update({ claimed_until: claimUntil })
      .eq('id', row.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    result.processed += 1
    try {
      const outcome = await processOne(db, row, now)
      if (outcome.sent) result.sent += 1
      if (outcome.task) result.tasks += 1
      if (outcome.expired) result.expired += 1
      if (outcome.error) result.errors.push(`${row.id}: ${outcome.error}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cadence step failed'
      console.error(`[leads] enrollment ${row.id}:`, err)
      await failStep(db, row.id, message)
      result.errors.push(`${row.id}: ${message}`)
    }
  }

  // Expire completed sequences that have sat past the window.
  const { data: cooling } = await db
    .from('cadence_enrollments')
    .select('id, account_id, contact_id, cadence_id, started_at')
    .eq('status', 'completed')
    .limit(50)

  for (const row of cooling ?? []) {
    const { data: cadence } = await db
      .from('cadences')
      .select('expire_after_days')
      .eq('id', row.cadence_id)
      .maybeSingle()
    const days = (cadence?.expire_after_days as number | undefined) ?? 30
    const started = new Date(row.started_at as string).getTime()
    if (now.getTime() < started + days * 24 * 60 * 60 * 1000) continue

    await db
      .from('cadence_enrollments')
      .update({
        status: 'exited',
        exit_reason: 'expired',
        completed_at: nowIso,
        next_run_at: null,
      })
      .eq('id', row.id)
    await cancelOpenTasks(db, {
      accountId: row.account_id as string,
      contactId: row.contact_id as string,
      enrollmentId: row.id as string,
    })
    await patchContactLead(db, {
      contactId: row.contact_id as string,
      accountId: row.account_id as string,
      patch: {
        lead_status: 'expired',
        next_action_at: null,
        next_action_type: 'expired',
      },
    })
    result.expired += 1
  }

  return result
}

