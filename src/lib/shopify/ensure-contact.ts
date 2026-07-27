import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface EnsuredContact {
  id: string;
  phone: string;
  name?: string | null;
}

/**
 * Find or create a contact for outbound Shopify campaign messages.
 */
export async function ensureShopifyContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
): Promise<EnsuredContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 8) return null;

  const existing = await findExistingContact(db, accountId, normalized);
  if (existing) {
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return { id: existing.id, phone: existing.phone, name: name || existing.name };
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone: normalized,
      name: name || normalized,
    })
    .select('id, phone, name')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, normalized);
      if (raced) return { id: raced.id, phone: raced.phone, name: raced.name };
    }
    console.error('[shopify] ensureShopifyContact failed:', error);
    return null;
  }

  return created;
}

/**
 * Find or create a conversation for a contact.
 *
 * `createStatus` applies only when inserting a new row (existing
 * conversations are returned unchanged).
 *
 * - Shopify campaigns / flows / outbound automations: `'closed'` so
 *   order confirmations don't crowd the Open inbox until the customer
 *   replies (inbound webhook reopens closed/followup).
 * - Agent "New message" inbox: `'open'`.
 */
export async function ensureConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
  opts?: { createStatus?: 'open' | 'closed' | 'pending' | 'followup' },
): Promise<{ id: string } | null> {
  const createStatus = opts?.createStatus ?? 'closed';

  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      status: createStatus,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[shopify] ensureConversation failed:', error);
    return null;
  }

  return created;
}

/**
 * Delete a conversation that never received any WhatsApp message (and
 * has no private notes). Used after Shopify outbound attempts that
 * created a thread without landing a send — empty shells must not
 * appear in Open or Closed.
 */
export async function deleteConversationIfEmpty(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { count: msgCount, error: msgErr } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (msgErr || (msgCount ?? 0) > 0) return;

  const { count: noteCount, error: noteErr } = await db
    .from('conversation_private_notes')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (noteErr || (noteCount ?? 0) > 0) return;

  const { error: deleteErr } = await db
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (deleteErr) {
    console.error('[shopify] deleteConversationIfEmpty failed:', deleteErr);
  }
}
