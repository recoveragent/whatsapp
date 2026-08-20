import type { SupabaseClient } from '@supabase/supabase-js'

import type { CrmTask } from './types'

export interface QueueTask extends CrmTask {
  contact: {
    id: string
    name: string | null
    phone: string
    lead_language: string | null
    lead_status: string | null
  } | null
  claimed_name: string | null
}

export interface RepliedLead {
  contact_id: string
  name: string | null
  phone: string
  lead_language: string | null
  last_touch_at: string | null
  conversation_id: string | null
  unread_count: number
}

export interface WaitingEnrollment {
  id: string
  contact_id: string
  name: string | null
  phone: string
  campaign_name: string | null
  current_step_position: number
  next_run_at: string | null
  last_error: string | null
  cadence_name: string | null
}

export interface LeadQueue {
  stats: {
    overdue: number
    due_now: number
    replied: number
    in_cadence: number
  }
  calls: QueueTask[]
  replied: RepliedLead[]
  waiting: WaitingEnrollment[]
}

function isOpenClaim(task: CrmTask, now: Date): boolean {
  if (task.status !== 'claimed') return false
  if (!task.claimed_until) return false
  return new Date(task.claimed_until).getTime() > now.getTime()
}

export async function loadLeadQueue(
  db: SupabaseClient,
  accountId: string,
): Promise<LeadQueue> {
  const now = new Date()

  const { data: taskRows, error: taskErr } = await db
    .from('crm_tasks')
    .select(
      '*, contact:contacts(id, name, phone, lead_language, lead_status)',
    )
    .eq('account_id', accountId)
    .in('status', ['pending', 'claimed'])
    .order('due_at', { ascending: true })
    .limit(100)

  if (taskErr) throw new Error(taskErr.message)

  const tasks = (taskRows as (CrmTask & {
    contact: QueueTask['contact']
  })[]) ?? []

  const claimedIds = [
    ...new Set(tasks.map((t) => t.claimed_by).filter((id): id is string => Boolean(id))),
  ]
  const nameByUser = new Map<string, string>()
  if (claimedIds.length > 0) {
    const { data: profiles } = await db
      .from('profiles')
      .select('user_id, full_name')
      .eq('account_id', accountId)
      .in('user_id', claimedIds)
    for (const p of profiles ?? []) {
      nameByUser.set(p.user_id as string, (p.full_name as string) || 'Teammate')
    }
  }

  const calls: QueueTask[] = tasks.map((t) => ({
    ...t,
    claimed_name: t.claimed_by ? nameByUser.get(t.claimed_by) ?? 'Teammate' : null,
  }))

  const overdue = calls.filter(
    (t) =>
      new Date(t.due_at).getTime() < now.getTime() &&
      (t.status === 'pending' || !isOpenClaim(t, now)),
  ).length
  const dueNow = calls.filter((t) => {
    const due = new Date(t.due_at).getTime() <= now.getTime()
    return due && (t.status === 'pending' || isOpenClaim(t, now))
  }).length

  const { data: repliedRows } = await db
    .from('contacts')
    .select(
      'id, name, phone, lead_language, last_touch_at, conversations(id, unread_count, last_message_at)',
    )
    .eq('account_id', accountId)
    .eq('lead_status', 'replied')
    .order('last_touch_at', { ascending: false })
    .limit(50)

  const replied: RepliedLead[] = (repliedRows ?? []).map((row) => {
    const convs = Array.isArray(row.conversations)
      ? row.conversations
      : row.conversations
        ? [row.conversations]
        : []
    const conv = convs.sort((a, b) => {
      const at = Date.parse(String(a.last_message_at ?? '')) || 0
      const bt = Date.parse(String(b.last_message_at ?? '')) || 0
      return bt - at
    })[0]
    return {
      contact_id: row.id as string,
      name: (row.name as string | null) ?? null,
      phone: row.phone as string,
      lead_language: (row.lead_language as string | null) ?? null,
      last_touch_at: (row.last_touch_at as string | null) ?? null,
      conversation_id: (conv?.id as string | undefined) ?? null,
      unread_count: Number(conv?.unread_count ?? 0),
    }
  })

  const { data: waitingRows } = await db
    .from('cadence_enrollments')
    .select(
      'id, contact_id, current_step_position, next_run_at, last_error, contacts(name, phone), lead_sources(name), cadences(name)',
    )
    .eq('account_id', accountId)
    .eq('status', 'active')
    .order('next_run_at', { ascending: true })
    .limit(50)

  const waiting: WaitingEnrollment[] = (waitingRows ?? []).map((row) => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    const source = Array.isArray(row.lead_sources)
      ? row.lead_sources[0]
      : row.lead_sources
    const cadence = Array.isArray(row.cadences) ? row.cadences[0] : row.cadences
    return {
      id: row.id as string,
      contact_id: row.contact_id as string,
      name: (contact?.name as string | null) ?? null,
      phone: (contact?.phone as string | null) ?? '',
      campaign_name: (source?.name as string | null) ?? null,
      current_step_position: row.current_step_position as number,
      next_run_at: (row.next_run_at as string | null) ?? null,
      last_error: (row.last_error as string | null) ?? null,
      cadence_name: (cadence?.name as string | null) ?? null,
    }
  })

  const { count: inCadence } = await db
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('lead_status', 'in_cadence')

  return {
    stats: {
      overdue,
      due_now: dueNow,
      replied: replied.length,
      in_cadence: inCadence ?? 0,
    },
    calls,
    replied,
    waiting,
  }
}
