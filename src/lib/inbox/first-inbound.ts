import type { SupabaseClient } from '@supabase/supabase-js'

import { findConversationsForContact } from '@/lib/inbox/ensure-conversation'

/**
 * True when this inbound is the contact's first-ever customer message
 * and we have never sent them a real outbound message (agent/bot).
 * Excludes timeline system rows (content_type = 'system').
 *
 * Used by the WhatsApp webhook for `first_inbound_message` flows and
 * automations — e.g. Shopify/cadence outbound followed by a reply should
 * not re-run a "welcome" flow.
 */
export async function isFirstColdInboundMessage(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const conversations = await findConversationsForContact(db, accountId, contactId)
  const conversationIds = conversations.map((c) => c.id)
  if (conversationIds.length === 0) return true

  const { count: priorCustomerMsgCount, error: customerErr } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', conversationIds)
    .eq('sender_type', 'customer')

  if (customerErr) {
    console.error('[inbox] isFirstColdInboundMessage customer count failed:', customerErr.message)
    return false
  }
  if ((priorCustomerMsgCount ?? 0) > 0) return false

  const { count: priorOutboundCount, error: outboundErr } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', conversationIds)
    .in('sender_type', ['agent', 'bot'])
    .neq('content_type', 'system')

  if (outboundErr) {
    console.error('[inbox] isFirstColdInboundMessage outbound count failed:', outboundErr.message)
    return false
  }

  return (priorOutboundCount ?? 0) === 0
}
