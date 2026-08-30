import { fetchOrder } from './admin-api';
import { orderInboxDisplayFields } from './extract-context';
import { deriveShopifyOrderStatus } from './order-links';
import type { ShopifyOrderPayload } from './types';
import type { ShopifyOrder } from '@/types';

export function mergeInboxDisplayFields(
  order: ShopifyOrder,
  live: ShopifyOrderPayload,
): ShopifyOrder {
  const inbox = orderInboxDisplayFields(live);
  return {
    ...order,
    order_status: deriveShopifyOrderStatus(live),
    product_title: inbox.product_title ?? order.product_title ?? null,
    shipping_address: inbox.shipping_address ?? order.shipping_address ?? null,
  };
}

export function enrichOrdersFromLivePayloads(
  orders: ShopifyOrder[],
  liveOrders: ShopifyOrderPayload[],
): ShopifyOrder[] {
  if (liveOrders.length === 0) return orders;

  const liveById = new Map(liveOrders.map((order) => [String(order.id), order]));
  return orders.map((order) => {
    const live = liveById.get(order.shopify_order_id);
    return live ? mergeInboxDisplayFields(order, live) : order;
  });
}

export function orderPayloadNeedsDetail(order: ShopifyOrderPayload): boolean {
  const inbox = orderInboxDisplayFields(order);
  return inbox.product_title == null && inbox.shipping_address == null;
}

/** List/search payloads sometimes omit line_items — fetch the full order once. */
export async function ensureOrderPayloadDetail(
  shopDomain: string,
  accessToken: string,
  order: ShopifyOrderPayload,
): Promise<ShopifyOrderPayload> {
  if (!orderPayloadNeedsDetail(order) || order.id == null) return order;

  try {
    const full = await fetchOrder(shopDomain, accessToken, order.id);
    return full ?? order;
  } catch (err) {
    console.warn('[shopify] ensureOrderPayloadDetail failed:', order.id, err);
    return order;
  }
}

export async function hydrateLiveOrderPayloads(
  shopDomain: string,
  accessToken: string,
  orders: ShopifyOrderPayload[],
): Promise<ShopifyOrderPayload[]> {
  return Promise.all(
    orders.map((order) => ensureOrderPayloadDetail(shopDomain, accessToken, order)),
  );
}

export function ordersNeedInboxDisplayEnrichment(orders: ShopifyOrder[]): boolean {
  return orders.some(
    (order) =>
      order.product_title == null ||
      /\+\d+ more$/.test(order.product_title.trim()),
  );
}

/** Fetch full Shopify payloads for cached rows missing inbox display fields. */
export async function fetchLivePayloadsForCachedOrders(
  shopDomain: string,
  accessToken: string,
  orders: ShopifyOrder[],
): Promise<ShopifyOrderPayload[]> {
  const shopifyOrderIds = [
    ...new Set(
      orders
        .filter((order) => order.product_title == null && order.shopify_order_id?.trim())
        .map((order) => order.shopify_order_id.trim()),
    ),
  ];

  if (shopifyOrderIds.length === 0) return [];

  const payloads = await Promise.all(
    shopifyOrderIds.map(async (shopifyOrderId) => {
      try {
        return await fetchOrder(shopDomain, accessToken, shopifyOrderId);
      } catch (err) {
        console.warn('[shopify] fetchLivePayloadsForCachedOrders failed:', shopifyOrderId, err);
        return null;
      }
    }),
  );

  return payloads.filter((order): order is ShopifyOrderPayload => order != null);
}

export async function enrichCachedOrdersFromShopify(
  accountId: string,
  orders: ShopifyOrder[],
  loadCredentials: (accountId: string) => Promise<{
    shopDomain: string;
    accessToken: string;
  } | null>,
  fetchByContact?: (accountId: string) => Promise<ShopifyOrderPayload[]>,
): Promise<{ orders: ShopifyOrder[]; liveOrders: ShopifyOrderPayload[] }> {
  if (!ordersNeedInboxDisplayEnrichment(orders)) {
    return { orders, liveOrders: [] };
  }

  const credentials = await loadCredentials(accountId);
  if (!credentials) return { orders, liveOrders: [] };

  let liveOrders = await fetchLivePayloadsForCachedOrders(
    credentials.shopDomain,
    credentials.accessToken,
    orders,
  );

  if (liveOrders.length === 0 && fetchByContact) {
    liveOrders = await fetchByContact(accountId);
  }

  if (liveOrders.length === 0) return { orders, liveOrders: [] };

  return {
    orders: enrichOrdersFromLivePayloads(orders, liveOrders),
    liveOrders,
  };
}
