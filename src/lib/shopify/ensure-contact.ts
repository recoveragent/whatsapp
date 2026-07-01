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

export async function ensureConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<{ id: string } | null> {
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
    })
    .select('id')
    .single();

  if (error) {
    console.error('[shopify] ensureConversation failed:', error);
    return null;
  }

  return created;
}
