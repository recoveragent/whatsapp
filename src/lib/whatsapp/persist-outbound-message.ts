import type { SupabaseClient } from '@supabase/supabase-js'

export const META_SENT_DB_INSERT_FAILED = 'sent to Meta but DB insert failed'

export function isMetaSentDbInsertFailed(message: string): boolean {
  return message.includes(META_SENT_DB_INSERT_FAILED)
}

const INSERT_RETRY_DELAYS_MS = [50, 150, 300, 500, 800]

/**
 * Persist an outbound message after Meta accepts the send. Retries
 * transient DB failures so the inbox thread matches what the customer
 * received on WhatsApp.
 */
export async function insertOutboundMessage(
  db: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  let lastMessage = 'unknown error'
  for (let attempt = 0; attempt < INSERT_RETRY_DELAYS_MS.length; attempt++) {
    const { error } = await db.from('messages').insert(row)
    if (!error) return
    lastMessage = error.message
    if (attempt < INSERT_RETRY_DELAYS_MS.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, INSERT_RETRY_DELAYS_MS[attempt]),
      )
    }
  }
  throw new Error(`${META_SENT_DB_INSERT_FAILED}: ${lastMessage}`)
}

interface ConversationPreviewUpdate {
  conversationId: string
  lastMessageText: string
}

/**
 * Best-effort inbox persistence after Meta already accepted the send.
 * Returns whether the row landed — callers must still return the WAMID
 * so flow/automation audit logs can backfill a missing bubble later.
 */
export async function persistOutboundAfterMetaSend(
  db: SupabaseClient,
  row: Record<string, unknown>,
  conversationUpdate?: ConversationPreviewUpdate,
): Promise<{ persisted: boolean }> {
  try {
    await insertOutboundMessage(db, row)
    if (conversationUpdate) {
      const { error } = await db
        .from('conversations')
        .update({
          last_message_text: conversationUpdate.lastMessageText,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationUpdate.conversationId)
      if (error) {
        console.error('[whatsapp] conversation preview update failed:', error)
      }
    }
    return { persisted: true }
  } catch (err) {
    console.error('[whatsapp] Meta send succeeded but DB persist failed:', err)
    return { persisted: false }
  }
}
