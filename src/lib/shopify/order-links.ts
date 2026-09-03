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

function normalizeShipmentStatus(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  ready_for_pickup: 'Ready for pickup',
  attempted_delivery: 'Attempted delivery',
  label_printed: 'Label printed',
  label_purchased: 'Label purchased',
  failure: 'Failure',
};

export function formatShipmentStatusLabel(
  status: string | null | undefined,
): string | null {
  const normalized = normalizeShipmentStatus(status);
  if (!normalized) return null;
  return SHIPMENT_STATUS_LABELS[normalized] ?? normalized.replace(/_/g, ' ');
}

type FulfillmentTrackingOverride = {
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipment_status?: string | null;
};

function extractTrackingFromFulfillments(
  fulfillments: NonNullable<ShopifyOrderPayload['fulfillments']>,
): FulfillmentTrackingOverride & { shipment_status: string | null } {
  for (const fulfillment of fulfillments) {
    const url = fulfillment.tracking_url?.trim();
    if (url) {
      return {
        tracking_url: url,
        tracking_number: fulfillment.tracking_number?.trim() || null,
        shipment_status: normalizeShipmentStatus(fulfillment.shipment_status),
      };
    }
  }

  for (const fulfillment of fulfillments) {
    const number = fulfillment.tracking_number?.trim();
    if (number) {
      return {
        tracking_url: null,
        tracking_number: number,
        shipment_status: normalizeShipmentStatus(fulfillment.shipment_status),
      };
    }
  }

  for (let i = fulfillments.length - 1; i >= 0; i -= 1) {
    const status = normalizeShipmentStatus(fulfillments[i]?.shipment_status);
    if (status) {
      return { tracking_url: null, tracking_number: null, shipment_status: status };
    }
  }

  return { tracking_url: null, tracking_number: null, shipment_status: null };
}

/** Prefer webhook fulfillment fields — REST order payloads often omit shipment_status. */
export function extractOrderTracking(
  order: ShopifyOrderPayload,
  fulfillmentOverride?: FulfillmentTrackingOverride | null,
): {
  tracking_url: string | null;
  tracking_number: string | null;
  shipment_status: string | null;
} {
  const base = extractTrackingFromFulfillments(order.fulfillments ?? []);
  if (!fulfillmentOverride) return base;

  const overrideStatus = normalizeShipmentStatus(fulfillmentOverride.shipment_status);
  return {
    tracking_url:
      base.tracking_url ?? fulfillmentOverride.tracking_url?.trim() ?? null,
    tracking_number:
      base.tracking_number ?? fulfillmentOverride.tracking_number?.trim() ?? null,
    shipment_status: overrideStatus ?? base.shipment_status,
  };
}

export function isFulfilledStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return normalized === 'fulfilled' || normalized === 'partial';
}
