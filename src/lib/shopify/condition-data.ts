import type { ShopifyCheckoutPayload, ShopifyOrderPayload } from './types';
import {
  conditionNumber,
  conditionPath,
  conditionList,
} from '@/lib/flows/conditions';
import type { ConditionPredicate } from '@/lib/flows/types';

export const DEFAULT_COD_GATEWAYS =
  'Cash on Delivery (COD),Cash on Delivery,COD';

/** Keep money numeric and IDs as strings; never compare formatted template text. */
export function shopifyConditionData(
  payload: ShopifyOrderPayload | ShopifyCheckoutPayload,
  kind: 'order' | 'checkout'
): Record<string, unknown> {
  const order = payload as ShopifyOrderPayload;
  const checkout = payload as ShopifyCheckoutPayload;
  const items = payload.line_items;
  const shipping = payload.shipping_address;
  const fulfillment = order.fulfillments;
  return {
    resource_type: kind,
    resource_id: payload.id == null ? undefined : String(payload.id),
    customer_id:
      payload.customer?.id == null ? undefined : String(payload.customer.id),
    // Webhook customer counts can be stale. Runtime fetches counts when selected.
    total: conditionNumber(
      kind === 'order'
        ? (order.current_total_price ?? order.total_price)
        : checkout.total_price
    ),
    currency: payload.currency,
    payment_status: kind === 'order' ? order.financial_status : undefined,
    payment_gateways:
      kind === 'order' ? order.payment_gateway_names : undefined,
    order_status:
      kind === 'order'
        ? order.cancelled_at
          ? 'cancelled'
          : order.closed_at
            ? 'closed'
            : 'open'
        : undefined,
    fulfillment_status:
      kind === 'order'
        ? (order.fulfillment_status ?? 'unfulfilled')
        : undefined,
    shipment_status: fulfillment?.flatMap((f) =>
      f.shipment_status ? [f.shipment_status] : []
    ),
    shipping_address: shipping,
    has_shipping_address: !!shipping?.address1?.trim(),
    tracking_numbers: fulfillment?.flatMap((f) =>
      f.tracking_number ? [f.tracking_number] : []
    ),
    tracking_urls: fulfillment?.flatMap((f) =>
      f.tracking_url ? [f.tracking_url] : []
    ),
    line_items: items,
    product_ids: items?.flatMap((i) =>
      i.product_id == null ? [] : [String(i.product_id)]
    ),
    variant_ids: items?.flatMap((i) =>
      i.variant_id == null ? [] : [String(i.variant_id)]
    ),
    skus: items?.flatMap((i) => (i.sku ? [i.sku] : [])),
    quantity:
      items && items.every((i) => conditionNumber(i.quantity) !== undefined)
        ? items.reduce((sum, i) => sum + i.quantity!, 0)
        : undefined,
    tags: kind === 'order' ? conditionList(order.tags) : undefined,
    discount_codes: payload.discount_codes?.flatMap((d) =>
      d.code ? [d.code] : []
    ),
    discount_total: conditionNumber(payload.total_discounts),
    created_at: payload.created_at,
  };
}

export function resolveShopifyConditionValue(
  data: Record<string, unknown>,
  cfg: ConditionPredicate,
  now = Date.now()
): unknown {
  if (cfg.subject_key === 'is_cod') {
    const gateways = data.payment_gateways;
    if (!Array.isArray(gateways)) return undefined;
    const names = conditionList(cfg.cod_gateways ?? DEFAULT_COD_GATEWAYS).map(
      (v) => v.toLowerCase()
    );
    return gateways.some((v) => names.includes(String(v).trim().toLowerCase()));
  }
  if (cfg.subject_key === 'age_hours') {
    const created = Date.parse(String(data.created_at ?? ''));
    return Number.isFinite(created)
      ? Math.max(0, (now - created) / 3_600_000)
      : undefined;
  }
  if (cfg.subject_key === 'item_quantity') {
    if (!Array.isArray(data.line_items) || !cfg.item_key || !cfg.item_value)
      return undefined;
    const selected = data.line_items.filter(
      (item) => item && String(item[cfg.item_key!]) === cfg.item_value
    );
    if (selected.some((item) => conditionNumber(item.quantity) === undefined))
      return undefined;
    return selected.reduce((sum, item) => sum + Number(item.quantity), 0);
  }
  return conditionPath(data, cfg.subject_key);
}
