import type { ShopifyOrderPayload } from './types';

export type ShopifyOrderLifecycleStatus = 'open' | 'cancelled' | 'archived';

export function deriveShopifyOrderStatus(
  order: Pick<ShopifyOrderPayload, 'cancelled_at' | 'closed_at'>,
): ShopifyOrderLifecycleStatus {
  if (order.cancelled_at) return 'cancelled';
  if (order.closed_at) return 'archived';
  return 'open';
}

export function formatShopifyOrderStatusLabel(
  status: string | null | undefined,
): string {
  switch (status) {
    case 'cancelled':
      return 'Cancelled';
    case 'archived':
      return 'Archived';
    case 'open':
      return 'Active';
    default:
      return 'Active';
  }
}

export function buildShopifyAdminOrderUrl(
  shopDomain: string,
  shopifyOrderId: string,
): string {
  const domain = shopDomain.includes('.')
    ? shopDomain
    : `${shopDomain}.myshopify.com`;
  return `https://${domain}/admin/orders/${shopifyOrderId}`;
}

/**
 * Split a public HTTPS URL into the static origin Meta needs on a
 * URL button (`https://store.com/`) and the dynamic suffix that
 * replaces `{{1}}`. Courier tracking links cannot use this because
 * their domains change; Shopify `order_status_url` can.
 */
export function splitPublicUrlForWhatsApp(raw: string | null | undefined): {
  url: string | null;
  prefix: string | null;
  suffix: string | null;
} {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url) return { url: null, prefix: null, suffix: null };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url, prefix: null, suffix: null };
    }
    const prefix = `${parsed.origin}/`;
    const suffix =
      `${parsed.pathname.replace(/^\//, '')}${parsed.search}${parsed.hash}` ||
      null;
    return { url: parsed.toString(), prefix, suffix };
  } catch {
    return { url, prefix: null, suffix: null };
  }
}

export function extractOrderStatusUrl(
  order: Pick<ShopifyOrderPayload, 'order_status_url'> | null | undefined,
): string | null {
  return splitPublicUrlForWhatsApp(order?.order_status_url).url;
}

export function extractOrderTracking(order: ShopifyOrderPayload): {
  tracking_url: string | null;
  tracking_number: string | null;
} {
  const fulfillments = order.fulfillments ?? [];

  for (const fulfillment of fulfillments) {
    const url = fulfillment.tracking_url?.trim();
    if (url) {
      return {
        tracking_url: url,
        tracking_number: fulfillment.tracking_number?.trim() || null,
      };
    }
  }

  for (const fulfillment of fulfillments) {
    const number = fulfillment.tracking_number?.trim();
    if (number) {
      return { tracking_url: null, tracking_number: number };
    }
  }

  return { tracking_url: null, tracking_number: null };
}

export function isFulfilledStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return normalized === 'fulfilled' || normalized === 'partial';
}
