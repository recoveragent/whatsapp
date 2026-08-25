import type { SupabaseClient } from '@supabase/supabase-js'

export const META_SENT_DB_INSERT_FAILED = 'sent to Meta but DB insert failed'

export function isMetaSentDbInsertFailed(message: string): boolean {
  return message.includes(META_SENT_DB_INSERT_FAILED)
}

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
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db.from('messages').insert(row)
    if (!error) return
    lastMessage = error.message
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
  throw new Error(`${META_SENT_DB_INSERT_FAILED}: ${lastMessage}`)
}
