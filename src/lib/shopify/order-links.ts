import type { ShopifyOrderPayload } from './types';

export function buildShopifyAdminOrderUrl(
  shopDomain: string,
  shopifyOrderId: string,
): string {
  const domain = shopDomain.includes('.')
    ? shopDomain
    : `${shopDomain}.myshopify.com`;
  return `https://${domain}/admin/orders/${shopifyOrderId}`;
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
