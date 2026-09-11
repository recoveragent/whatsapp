import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { ShopifyOrder } from '@/types';

import { filterCachedOrdersForContact } from './match-order-contact';

function matchOrdersByPhone(orders: ShopifyOrder[], phone: string): ShopifyOrder[] {
  return orders.filter(
    (o) => Boolean(o.customer_phone && phonesMatch(o.customer_phone, phone)),
  );
}

async function linkVerifiedOrders(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  orders: ShopifyOrder[],
): Promise<void> {
  const ids = orders
    .filter((o) => o.contact_id !== contactId)
    .map((o) => o.id);
  if (ids.length === 0) return;

  await db
    .from('shopify_orders')
    .update({ contact_id: contactId, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .in('id', ids);
}

/**
 * Load cached Shopify orders for an inbox contact. Phone-first match, then
 * contact_id fallback — same logic the inbox orders sidebar uses.
 */
export async function loadCachedOrdersForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  phone: string | null,
  options?: { linkContact?: boolean },
): Promise<ShopifyOrder[]> {
  const linkContact = options?.linkContact !== false;
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  if (normalizedPhone) {
    const suffix =
      normalizedPhone.length >= 10
        ? normalizedPhone.slice(-10)
        : normalizedPhone.length >= 8
          ? normalizedPhone.slice(-8)
          : normalizedPhone;

    const { data: candidates, error: candidateErr } = await db
      .from('shopify_orders')
      .select('*')
      .eq('account_id', accountId)
      .not('customer_phone', 'is', null)
      .like('customer_phone', `%${suffix}`)
      .order('ordered_at', { ascending: false })
      .limit(100);

    if (candidateErr) throw candidateErr;

    const matched = matchOrdersByPhone((candidates ?? []) as ShopifyOrder[], normalizedPhone);
    if (matched.length > 0) {
      if (linkContact) {
        await linkVerifiedOrders(db, accountId, contactId, matched);
      }
      return matched;
    }
  }

  const { data: linked, error: linkedErr } = await db
    .from('shopify_orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('ordered_at', { ascending: false })
    .limit(50);

  if (linkedErr) throw linkedErr;

  return filterCachedOrdersForContact((linked ?? []) as ShopifyOrder[], phone, contactId);
}
