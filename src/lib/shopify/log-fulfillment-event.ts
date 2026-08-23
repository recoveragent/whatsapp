import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeShopifyShipmentStatus } from '@/lib/flows/trigger-types';
import type { ShopifyFulfillmentPayload, ShopifyOrderPayload } from './types';

export async function logShopifyFulfillmentEvent(args: {
  db: SupabaseClient;
  accountId: string;
  topic: 'fulfillments/create' | 'fulfillments/update';
  fulfillment: ShopifyFulfillmentPayload;
  order?: ShopifyOrderPayload | null;
}): Promise<void> {
  const fulfillmentId = args.fulfillment.id;
  if (fulfillmentId == null) return;

  const rawStatus = args.fulfillment.shipment_status ?? null;
  const normalized =
    rawStatus == null ? null : normalizeShopifyShipmentStatus(rawStatus);

  const { error } = await args.db.from('shopify_fulfillment_events').insert({
    account_id: args.accountId,
    shopify_order_id: args.fulfillment.order_id
      ? String(args.fulfillment.order_id)
      : args.order?.id != null
        ? String(args.order.id)
        : null,
    order_number:
      args.order?.name ??
      (args.order?.order_number != null ? `#${args.order.order_number}` : null),
    shopify_fulfillment_id: String(fulfillmentId),
    webhook_topic: args.topic,
    shipment_status: normalized,
    raw_shipment_status: rawStatus,
  });

  if (error) {
    console.warn('[shopify] logShopifyFulfillmentEvent failed:', error.message);
  }
}
