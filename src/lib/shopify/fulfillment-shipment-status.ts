import type { SupabaseClient } from '@supabase/supabase-js';

import { isFulfilledStatus } from './order-links';
import type { ShopifyOrder } from '@/types';

/** Fulfilled orders with tracking but no stored carrier scan status. */
export function ordersNeedTrackingRefresh(orders: ShopifyOrder[]): boolean {
  return orders.some(
    (order) =>
      isFulfilledStatus(order.fulfillment_status) &&
      Boolean(order.tracking_url?.trim() || order.tracking_number?.trim()) &&
      !order.shipment_status?.trim(),
  );
}

export async function loadLatestShipmentStatuses(
  db: SupabaseClient,
  accountId: string,
  shopifyOrderIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(shopifyOrderIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await db
    .from('shopify_fulfillment_events')
    .select('shopify_order_id, shipment_status, received_at')
    .eq('account_id', accountId)
    .in('shopify_order_id', ids)
    .not('shipment_status', 'is', null)
    .order('received_at', { ascending: false });

  if (error) {
    console.warn('[shopify] loadLatestShipmentStatuses failed:', error.message);
    return new Map();
  }

  const latest = new Map<string, string>();
  for (const row of data ?? []) {
    const orderId = row.shopify_order_id;
    const status = row.shipment_status;
    if (typeof orderId === 'string' && typeof status === 'string' && !latest.has(orderId)) {
      latest.set(orderId, status);
    }
  }

  return latest;
}

export function applyLatestShipmentStatuses(
  orders: ShopifyOrder[],
  latestByOrderId: Map<string, string>,
): ShopifyOrder[] {
  if (latestByOrderId.size === 0) return orders;

  return orders.map((order) => {
    if (order.shipment_status?.trim()) return order;
    const latest = latestByOrderId.get(order.shopify_order_id);
    return latest ? { ...order, shipment_status: latest } : order;
  });
}
