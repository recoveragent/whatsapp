import type { SupabaseClient } from '@supabase/supabase-js';

import { hasShopifyOrdersTable } from '@/lib/inbox/tables';
import { loadCachedOrdersForContact } from '@/lib/shopify/contact-orders';
import type { ShopifyOrder } from '@/types';

const DEFAULT_ORDER_LIMIT = 5;

/** How many recent Shopify orders to inject into the AI prompt. */
export function aiShopifyOrderLimit(): number {
  const raw = Number(process.env.AI_SHOPIFY_ORDER_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ORDER_LIMIT;
}

function formatOrderDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** One order block for the AI system prompt. */
export function formatShopifyOrderForAi(order: ShopifyOrder): string {
  const lines: string[] = [];
  const date = formatOrderDate(order.ordered_at);

  lines.push(`Order ${order.order_number}${date ? ` (${date})` : ''}`);

  if (order.product_title?.trim()) {
    lines.push(`- Items: ${order.product_title.replace(/\n+/g, '; ')}`);
  }

  if (order.total_price) {
    const currency = order.currency?.trim();
    lines.push(`- Total: ${order.total_price}${currency ? ` ${currency}` : ''}`);
  }

  if (order.payment_status) {
    lines.push(`- Payment: ${order.payment_status}`);
  }

  if (order.order_status && order.order_status !== 'open') {
    lines.push(`- Order status: ${order.order_status}`);
  }

  const fulfillmentParts: string[] = [];
  if (order.fulfillment_status) fulfillmentParts.push(order.fulfillment_status);
  if (order.shipment_status) {
    fulfillmentParts.push(order.shipment_status.replace(/_/g, ' '));
  }
  if (fulfillmentParts.length > 0) {
    lines.push(`- Fulfillment: ${fulfillmentParts.join(' — ')}`);
  }

  if (order.tracking_number || order.tracking_url) {
    const tracking = [order.tracking_number, order.tracking_url].filter(Boolean).join(' — ');
    lines.push(`- Tracking: ${tracking}`);
  }

  if (order.shipping_address?.trim()) {
    lines.push(`- Ships to: ${order.shipping_address.replace(/\n+/g, ', ')}`);
  }

  return lines.join('\n');
}

/** Format recent orders into a prompt section (most recent first). */
export function formatShopifyOrdersForAi(orders: ShopifyOrder[]): string {
  if (orders.length === 0) return '';
  return orders
    .slice(0, aiShopifyOrderLimit())
    .map(formatShopifyOrderForAi)
    .join('\n\n');
}

/**
 * Best-effort Shopify order context for a contact. Returns null when the
 * store isn't connected, the table is missing, or no orders match — never
 * throws (AI reply must not fail because Shopify lookup did).
 */
export async function retrieveShopifyContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  try {
    const { data: config } = await db
      .from('shopify_config')
      .select('status')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config || config.status !== 'connected') return null;

    if (!(await hasShopifyOrdersTable())) return null;

    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (contactErr || !contact) return null;

    const orders = await loadCachedOrdersForContact(
      db,
      accountId,
      contactId,
      contact.phone,
      { linkContact: false },
    );

    const formatted = formatShopifyOrdersForAi(orders);
    return formatted || null;
  } catch (err) {
    console.warn('[ai shopify-context] retrieval failed:', err);
    return null;
  }
}
