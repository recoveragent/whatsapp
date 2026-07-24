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

export async function insertConversationStatusMessage(args: {
  db: SupabaseClient
  conversationId: string
  status: ConversationStatus
  actor: StatusChangeActor
  at?: Date
}): Promise<Message | null> {
  const createdAt = (args.at ?? new Date()).toISOString()
  const contentText = formatConversationStatusCopy(args.status, args.actor)

  const row = {
    conversation_id: args.conversationId,
    sender_type: 'bot' as const,
    sender_id: args.actor.kind === 'agent' ? args.actor.userId : null,
    content_type: 'system' as const,
    content_text: contentText,
    status: 'delivered' as const,
    created_at: createdAt,
  }

  const { data, error } = await args.db
    .from('messages')
    .insert(row)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[inbox] status system message insert failed:', error)
    return null
  }

  return data as Message | null
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
