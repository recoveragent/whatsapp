import type { SupabaseClient } from '@supabase/supabase-js'

import { exitEnrollment } from './pause'
import { CLAIM_MINUTES, isCrmTaskOutcome, type CrmTaskOutcome } from './types'

export async function claimCrmTask(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  taskId: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const now = new Date()
  const { data: task, error } = await args.db
    .from('crm_tasks')
    .select('id, status, claimed_by, claimed_until')
    .eq('id', args.taskId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (error || !task) {
    return { ok: false, status: 404, error: 'Task not found' }
  }

  const claimedUntil = task.claimed_until
    ? new Date(task.claimed_until as string)
    : null
  const heldByOther =
    task.status === 'claimed' &&
    task.claimed_by &&
    task.claimed_by !== args.userId &&
    claimedUntil &&
    claimedUntil.getTime() > now.getTime()

  if (heldByOther) {
    return { ok: false, status: 409, error: 'Someone else is on this call' }
  }

  const until = new Date(now.getTime() + CLAIM_MINUTES * 60_000).toISOString()
  const { error: updErr } = await args.db
    .from('crm_tasks')
    .update({
      status: 'claimed',
      claimed_by: args.userId,
      claimed_until: until,
    })
    .eq('id', args.taskId)

  if (updErr) return { ok: false, status: 500, error: updErr.message }
  return { ok: true }
}

export async function completeCrmTask(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  taskId: string
  outcome: unknown
  note?: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isCrmTaskOutcome(args.outcome)) {
    return { ok: false, status: 400, error: 'Invalid outcome' }
  }
  const outcome: CrmTaskOutcome = args.outcome

  const { data: task, error } = await args.db
    .from('crm_tasks')
    .select('id, contact_id, status')
    .eq('id', args.taskId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (error || !task) {
    return { ok: false, status: 404, error: 'Task not found' }
  }
  if (task.status === 'completed' || task.status === 'cancelled') {
    return { ok: false, status: 409, error: 'Task is already closed' }
  }

  const now = new Date().toISOString()
  const { error: updErr } = await args.db
    .from('crm_tasks')
    .update({
      status: 'completed',
      outcome,
      outcome_note: args.note?.trim() || null,
      completed_by: args.userId,
      completed_at: now,
      claimed_until: null,
    })
    .eq('id', args.taskId)

  if (updErr) return { ok: false, status: 500, error: updErr.message }

  const contactId = task.contact_id as string
  if (outcome === 'booked') {
    await exitEnrollment({
      db: args.db,
      accountId: args.accountId,
      contactId,
      reason: 'meeting_booked',
      nextLeadStatus: 'meeting_booked',
    })
  } else if (outcome === 'not_interested') {
    await exitEnrollment({
      db: args.db,
      accountId: args.accountId,
      contactId,
      reason: 'not_interested',
      nextLeadStatus: 'lost',
    })
  } else if (outcome === 'wrong_number') {
    await exitEnrollment({
      db: args.db,
      accountId: args.accountId,
      contactId,
      reason: 'wrong_number',
      nextLeadStatus: 'lost',
    })
  }

  return { ok: true }
}
