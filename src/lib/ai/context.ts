import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { withQuickReplyContext } from './quick-replies'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  interactive_payload?: InteractiveMessagePayload | null
}

/**
 * Fetch the last N text/interactive messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Include button prompts and taps so
 * a short answer such as "Yes" retains its question and answer choices.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, interactive_payload')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: withQuickReplyContext(
        m.content_text!.trim(),
        m.sender_type !== 'customer' && m.interactive_payload?.kind === 'buttons'
          ? m.interactive_payload.buttons.map((button) => button.title)
          : [],
      ),
    }))
}
