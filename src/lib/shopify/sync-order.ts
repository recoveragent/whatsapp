import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { contextFromOrder } from './extract-context';
import { extractOrderTracking } from './order-links';
import type { ShopifyOrderPayload } from './types';

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

export async function syncShopifyOrder(
  db: SupabaseClient,
  accountId: string,
  order: ShopifyOrderPayload,
  shopName: string,
): Promise<void> {
  if (!order.id) return;

  const ctx = contextFromOrder(order, shopName);
  let contactId: string | null = null;
  const customerPhone = ctx.phone ? normalizePhone(ctx.phone) : null;

  if (customerPhone) {
    const existing = await findExistingContact(db, accountId, customerPhone);
    contactId = existing?.id ?? null;
  }

  const paymentGateway =
    Array.isArray((order as { payment_gateway_names?: string[] }).payment_gateway_names)
      ? (order as { payment_gateway_names?: string[] }).payment_gateway_names?.[0] ?? null
      : null;

  const tracking = extractOrderTracking(order);

  const { error } = await db.from('shopify_orders').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      customer_phone: customerPhone,
      shopify_order_id: String(order.id),
      order_number: order.name ?? (order.order_number != null ? `#${order.order_number}` : String(order.id)),
      total_price: order.total_price ?? null,
      currency: order.currency ?? null,
      payment_status: (order as { financial_status?: string }).financial_status ?? null,
      payment_gateway: paymentGateway,
      fulfillment_status:
        (order as { fulfillment_status?: string | null }).fulfillment_status ?? 'unfulfilled',
      tracking_url: tracking.tracking_url,
      tracking_number: tracking.tracking_number,
      tags: parseTags((order as { tags?: string }).tags),
      ordered_at: (order as { created_at?: string }).created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,shopify_order_id' },
  );

  if (error) {
    console.error('[shopify] syncShopifyOrder failed:', error);
  }
}
