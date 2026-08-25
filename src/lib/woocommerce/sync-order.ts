import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import { buildWooCommerceOrderStatusUrl } from './admin-api';
import { extractOrderPhone } from './extract-context';
import type { WooCommerceOrderPayload } from './types';

function mapFulfillmentStatus(status: string | undefined): string {
  if (!status) return 'unfulfilled';
  if (status === 'completed') return 'fulfilled';
  if (status === 'cancelled' || status === 'refunded' || status === 'failed') {
    return status;
  }
  return status;
}

export async function syncWooCommerceOrder(
  db: SupabaseClient,
  accountId: string,
  order: WooCommerceOrderPayload,
  storeUrl: string,
): Promise<void> {
  if (!order.id) return;

  const customerPhone = extractOrderPhone(order);
  let contactId: string | null = null;

  if (customerPhone) {
    const existing = await findExistingContact(db, accountId, customerPhone);
    contactId = existing?.id ?? null;
  }

  const { error } = await db.from('woocommerce_orders').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      customer_phone: customerPhone,
      woocommerce_order_id: String(order.id),
      order_number: order.number ? `#${order.number}` : `#${order.id}`,
      total_price: order.total ?? null,
      currency: order.currency ?? null,
      payment_status: order.status ?? null,
      payment_gateway: order.payment_method_title ?? order.payment_method ?? null,
      fulfillment_status: mapFulfillmentStatus(order.status),
      order_status_url: buildWooCommerceOrderStatusUrl(storeUrl, order.id, order.order_key),
      tags: [],
      ordered_at: order.date_created ?? order.date_created_gmt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,woocommerce_order_id' },
  );

  if (error) {
    console.error('[woocommerce] syncWooCommerceOrder failed:', error);
  }
}
