import type { SupabaseClient } from '@supabase/supabase-js'

import type { ConversationStatus, Message } from '@/types'

export type StatusChangeActor =
  | { kind: 'agent'; name: string; userId: string }
  | { kind: 'customer' }
  | { kind: 'automation' }
  | { kind: 'flow' }

const STATUS_VERB: Record<ConversationStatus, string> = {
  open: 'Chat opened',
  closed: 'Chat closed',
  followup: 'Marked for follow-up',
  pending: 'Marked as pending',
}

/**
 * Human-readable inbox microcopy for a conversation status change.
 * Timestamp is rendered by the UI from `message.created_at`.
 */
export function formatConversationStatusCopy(
  status: ConversationStatus,
  actor: StatusChangeActor,
): string {
  const verb = STATUS_VERB[status] ?? `Status set to ${status}`

  switch (actor.kind) {
    case 'agent':
      return `${verb} by ${actor.name.trim() || 'agent'}`
    case 'customer':
      return `${verb} · customer replied`
    case 'automation':
      return `${verb} by automation`
    case 'flow':
      return `${verb} by flow`
  }
}

export type AssignmentChange =
  | { kind: 'self'; actorName: string }
  | { kind: 'assign'; actorName: string; assigneeName: string }
  | { kind: 'unassign'; actorName: string }

/** Timeline microcopy for assignment changes. */
export function formatAssignmentCopy(change: AssignmentChange): string {
  const actor = change.actorName.trim() || 'agent'
  switch (change.kind) {
    case 'self':
      return `Self-assigned by ${actor}`
    case 'assign':
      return `Assigned to ${change.assigneeName.trim() || 'agent'} by ${actor}`
    case 'unassign':
      return `Unassigned by ${actor}`
  }
}

async function insertSystemMessage(args: {
  db: SupabaseClient
  conversationId: string
  contentText: string
  senderId?: string | null
  at?: Date
}): Promise<Message | null> {
  const createdAt = (args.at ?? new Date()).toISOString()

  const { data, error } = await args.db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      sender_id: args.senderId ?? null,
      content_type: 'system',
      content_text: args.contentText,
      status: 'delivered',
      created_at: createdAt,
    })
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[inbox] system message insert failed:', error)
    return null
  }

  return data as Message | null
}

export async function insertConversationStatusMessage(args: {
  db: SupabaseClient
  conversationId: string
  status: ConversationStatus
  actor: StatusChangeActor
  at?: Date
}): Promise<Message | null> {
  return insertSystemMessage({
    db: args.db,
    conversationId: args.conversationId,
    contentText: formatConversationStatusCopy(args.status, args.actor),
    senderId: args.actor.kind === 'agent' ? args.actor.userId : null,
    at: args.at,
  })
}

export async function insertAssignmentSystemMessage(args: {
  db: SupabaseClient
  conversationId: string
  change: AssignmentChange
  actorUserId: string
  at?: Date
}): Promise<Message | null> {
  return insertSystemMessage({
    db: args.db,
    conversationId: args.conversationId,
    contentText: formatAssignmentCopy(args.change),
    senderId: args.actorUserId,
    at: args.at,
  })
}

export async function resolveAgentDisplayName(
  db: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .maybeSingle()

  const name = data?.full_name?.trim()
  if (name) return name
  const email = data?.email?.trim()
  if (email) return email.split('@')[0] || email
  return 'agent'
}
