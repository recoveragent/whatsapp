import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact } from '@/lib/contacts/dedupe'
import { canonicalContactPhone, normalizePhone } from '@/lib/whatsapp/phone-utils'

export async function incrementLeadDuplicateCount(
  db: SupabaseClient,
  contactId: string,
  accountId: string,
): Promise<void> {
  const { error } = await db.rpc('increment_contact_lead_duplicate_count', {
    p_contact_id: contactId,
    p_account_id: accountId,
  })
  if (error) {
    console.error('[leads] increment lead_duplicate_count failed:', error.message)
  }
}

/**
 * When a lead row matches an existing contact (same phone), bump the duplicate counter.
 * Returns true when the contact already existed before this ingest.
 */
export async function recordDuplicateLeadEntryIfExists(
  db: SupabaseClient,
  accountId: string,
  phoneRaw: string,
): Promise<boolean> {
  const normalized = canonicalContactPhone(normalizePhone(phoneRaw))
  if (!normalized) return false

  const existing = await findExistingContact(db, accountId, normalized)
  if (!existing) return false

  await incrementLeadDuplicateCount(db, existing.id, accountId)
  return true
}
