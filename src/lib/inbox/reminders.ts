import type { SupabaseClient } from '@supabase/supabase-js'

import type { InboxReminder } from '@/types'

export const REMINDER_NOTE_MAX_LENGTH = 500

export type ReminderWithContact = InboxReminder & {
  contact: { id: string; name?: string | null; phone: string } | null
}

function resolveContact(
  contact:
    | { id: string; name?: string | null; phone: string }
    | { id: string; name?: string | null; phone: string }[]
    | null
    | undefined,
): ReminderWithContact['contact'] {
  if (!contact) return null
  return Array.isArray(contact) ? contact[0] ?? null : contact
}

export function normalizeReminderRow(row: {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string
  created_by: string
  note: string
  due_at: string
  status: string
  completed_at: string | null
  created_at: string
  updated_at: string
  contact?:
    | { id: string; name?: string | null; phone: string }
    | { id: string; name?: string | null; phone: string }[]
    | null
}): ReminderWithContact {
  return {
    id: row.id,
    account_id: row.account_id,
    conversation_id: row.conversation_id,
    contact_id: row.contact_id,
    created_by: row.created_by,
    note: row.note,
    due_at: row.due_at,
    status: row.status as InboxReminder['status'],
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    contact: resolveContact(row.contact),
  }
}

const REMINDER_SELECT =
  'id, account_id, conversation_id, contact_id, created_by, note, due_at, status, completed_at, created_at, updated_at, contact:contacts(id, name, phone)'

export async function listDueReminders(
  db: SupabaseClient,
  accountId: string,
  now = new Date(),
): Promise<ReminderWithContact[]> {
  const { data, error } = await db
    .from('inbox_reminders')
    .select(REMINDER_SELECT)
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .lte('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(50)

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) =>
    normalizeReminderRow(row as Parameters<typeof normalizeReminderRow>[0]),
  )
}

export async function listCompletedReminders(
  db: SupabaseClient,
  accountId: string,
  limit = 30,
): Promise<ReminderWithContact[]> {
  const { data, error } = await db
    .from('inbox_reminders')
    .select(REMINDER_SELECT)
    .eq('account_id', accountId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) =>
    normalizeReminderRow(row as Parameters<typeof normalizeReminderRow>[0]),
  )
}

export async function listConversationReminders(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ReminderWithContact[]> {
  const { data, error } = await db
    .from('inbox_reminders')
    .select(REMINDER_SELECT)
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .order('due_at', { ascending: true })
    .limit(20)

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) =>
    normalizeReminderRow(row as Parameters<typeof normalizeReminderRow>[0]),
  )
}

/** Quick snooze offsets (minutes). Custom datetime is also allowed. */
export const SNOOZE_PRESETS_MINUTES = [15, 30, 60, 180, 300] as const

export function snoozePresetLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours}h` : `${minutes}m`
}

export function dueAtFromSnoozeMinutes(minutes: number, from = new Date()): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString()
}

export async function createReminder(
  db: SupabaseClient,
  args: {
    accountId: string
    userId: string
    conversationId: string
    contactId: string
    note: string
    dueAt: string
  },
): Promise<ReminderWithContact> {
  const { data, error } = await db
    .from('inbox_reminders')
    .insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      created_by: args.userId,
      note: args.note,
      due_at: args.dueAt,
      status: 'pending',
    })
    .select(REMINDER_SELECT)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create reminder')
  }

  return normalizeReminderRow(data as Parameters<typeof normalizeReminderRow>[0])
}

export async function completeReminder(
  db: SupabaseClient,
  accountId: string,
  reminderId: string,
): Promise<ReminderWithContact> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('inbox_reminders')
    .update({
      status: 'completed',
      completed_at: now,
      updated_at: now,
    })
    .eq('id', reminderId)
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .select(REMINDER_SELECT)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Reminder not found or already completed')
  return normalizeReminderRow(data as Parameters<typeof normalizeReminderRow>[0])
}

export async function snoozeReminder(
  db: SupabaseClient,
  accountId: string,
  reminderId: string,
  dueAt: string,
): Promise<ReminderWithContact> {
  const { data, error } = await db
    .from('inbox_reminders')
    .update({
      due_at: dueAt,
      status: 'pending',
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reminderId)
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .select(REMINDER_SELECT)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Reminder not found or already completed')
  return normalizeReminderRow(data as Parameters<typeof normalizeReminderRow>[0])
}
