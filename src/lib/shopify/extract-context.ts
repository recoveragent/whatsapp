import type {
  ShopifyAddressFields,
  ShopifyCheckoutPayload,
  ShopifyEventContext,
  ShopifyFulfillmentPayload,
  ShopifyLineItemFields,
  ShopifyOrderPayload,
  ShopifyVariableKey,
} from './types';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

function fullName(
  first?: string | null,
  last?: string | null,
): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

function extractPhone(payload: {
  phone?: string;
  contact_phone?: string;
  customer?: { phone?: string; default_address?: { phone?: string } };
  shipping_address?: { phone?: string };
  billing_address?: { phone?: string };
}): string | null {
  const candidates = [
    payload.phone,
    payload.contact_phone,
    payload.customer?.phone,
    payload.customer?.default_address?.phone,
    payload.shipping_address?.phone,
    payload.billing_address?.phone,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const normalized = normalizePhone(raw);
    if (normalized.length >= 8) return normalized;
  }
  return null;
}

export function extractOrderPhone(order: ShopifyOrderPayload): string | null {
  return extractPhone(order);
}

export function extractOrderEmail(order: ShopifyOrderPayload): string | null {
  return order.email ?? order.customer?.email ?? null;
}

/** Comma-joined line items for WhatsApp template vars (all items). */
function formatLineItems(
  items: ShopifyLineItemFields[] | undefined,
): string | null {
  if (!items?.length) return null;
  return items
    .map((item) => {
      const label = item.name ?? item.title ?? 'Item';
      const qty = item.quantity ?? 1;
      return qty > 1 ? `${label} ×${qty}` : label;
    })
    .join(', ');
}

/** First product image URL already present on line items (rare on REST webhooks). */
export function imageUrlFromLineItems(
  items: ShopifyLineItemFields[] | undefined,
): string | null {
  if (!items?.length) return null;
  for (const item of items) {
    const src =
      (typeof item.image_url === 'string' && item.image_url.trim()) ||
      (typeof item.image?.src === 'string' && item.image.src.trim()) ||
      (typeof item.image?.url === 'string' && item.image.url.trim()) ||
      null;
    if (src) return src;
  }
  return null;
}

/** First line item with a product_id (for Admin API image lookup). */
export function firstProductIdFromLineItems(
  items: ShopifyLineItemFields[] | undefined,
): string | null {
  if (!items?.length) return null;
  for (const item of items) {
    if (item.product_id != null && String(item.product_id).trim()) {
      return String(item.product_id);
    }
  }
  return null;
}

function formatMoney(amount: string | undefined, currency: string | undefined): string | null {
  if (!amount) return null;
  return currency ? `${amount} ${currency}` : amount;
}

/** Single-line shipping address suitable for template body params. */
export function formatShippingAddress(
  address: ShopifyAddressFields | null | undefined,
): string | null {
  if (!address) return null;

  const name =
    address.name?.trim() ||
    fullName(address.first_name, address.last_name) ||
    null;
  const region = [address.city, address.province || address.province_code, address.zip]
    .filter(Boolean)
    .join(', ');
  const country = address.country || address.country_code || null;

  const parts = [
    name,
    address.company,
    address.address1,
    address.address2,
    region || null,
    country,
  ]
    .map((p) => (typeof p === 'string' ? p.trim() : p))
    .filter((p): p is string => !!p);

  return parts.length > 0 ? parts.join(', ') : null;
}

export function contextFromOrder(
  order: ShopifyOrderPayload,
  shopName: string,
): ShopifyEventContext {
  const customerName =
    fullName(order.customer?.first_name, order.customer?.last_name) ||
    fullName(order.shipping_address?.first_name, order.shipping_address?.last_name) ||
    'Customer';

  return {
    customerName,
    phone: extractOrderPhone(order),
    email: extractOrderEmail(order),
    orderNumber: order.name ?? (order.order_number != null ? `#${order.order_number}` : null),
    orderTotal: formatMoney(order.total_price, order.currency),
    orderItems: formatLineItems(order.line_items),
    productImage: imageUrlFromLineItems(order.line_items),
    shippingAddress:
      formatShippingAddress(order.shipping_address) ||
      formatShippingAddress(order.billing_address),
    trackingNumber: null,
    trackingUrl: null,
    checkoutUrl: null,
    fulfillmentStatus: order.fulfillment_status ?? null,
    financialStatus: order.financial_status ?? null,
    shopName,
    resourceKey: `order:${order.id}`,
  };
}

export function contextFromCheckout(
  checkout: ShopifyCheckoutPayload,
  shopName: string,
): ShopifyEventContext {
  const customerName =
    fullName(checkout.customer?.first_name, checkout.customer?.last_name) ||
    fullName(checkout.shipping_address?.first_name, checkout.shipping_address?.last_name) ||
    'Customer';

  return {
    customerName,
    phone: extractPhone(checkout),
    email: checkout.email ?? checkout.customer?.email ?? null,
    orderNumber: null,
    orderTotal: formatMoney(checkout.total_price, checkout.currency),
    orderItems: formatLineItems(checkout.line_items),
    productImage: imageUrlFromLineItems(checkout.line_items),
    shippingAddress:
      formatShippingAddress(checkout.shipping_address) ||
      formatShippingAddress(checkout.billing_address),
    trackingNumber: null,
    trackingUrl: null,
    checkoutUrl: checkout.abandoned_checkout_url ?? null,
    fulfillmentStatus: null,
    financialStatus: null,
    shopName,
    resourceKey: `checkout:${checkout.id ?? checkout.token}`,
  };
}

export function contextFromFulfillment(
  fulfillment: ShopifyFulfillmentPayload,
  order: ShopifyOrderPayload | null,
  shopName: string,
): ShopifyEventContext {
  const base = order ? contextFromOrder(order, shopName) : {
    customerName: 'Customer',
    phone: null,
    email: null,
    orderNumber: null,
    orderTotal: null,
    orderItems: null,
    productImage: null,
    shippingAddress: null,
    trackingNumber: null,
    trackingUrl: null,
    checkoutUrl: null,
    fulfillmentStatus: null,
    financialStatus: null,
    shopName,
    resourceKey: `fulfillment:${fulfillment.id}`,
  };

  return {
    ...base,
    trackingNumber: fulfillment.tracking_number ?? fulfillment.tracking_company ?? null,
    trackingUrl: fulfillment.tracking_url ?? null,
    fulfillmentStatus: fulfillment.status ?? 'updated',
    resourceKey: `fulfillment:${fulfillment.id}`,
  };
}

export function buildTemplateParams(
  mapping: Record<string, ShopifyVariableKey>,
  ctx: ShopifyEventContext,
): string[] {
  const entries = Object.entries(mapping)
    .map(([index, key]) => ({ index: Number(index), key }))
    .filter((e) => Number.isFinite(e.index) && e.index > 0)
    .sort((a, b) => a.index - b.index);

  if (entries.length === 0) return [];

  const maxIndex = entries[entries.length - 1]!.index;
  const params = new Array<string>(maxIndex).fill('');

  for (const { index, key } of entries) {
    params[index - 1] = resolveVariable(key, ctx);
  }

  return params;
}

function resolveVariable(key: ShopifyVariableKey, ctx: ShopifyEventContext): string {
  switch (key) {
    case 'customer_name':
      return ctx.customerName;
    case 'order_number':
      return ctx.orderNumber ?? '';
    case 'order_total':
      return ctx.orderTotal ?? '';
    case 'order_items':
      return ctx.orderItems ?? '';
    case 'product_image':
      return ctx.productImage ?? '';
    case 'shipping_address':
      return ctx.shippingAddress ?? '';
    case 'tracking_number':
      return ctx.trackingNumber ?? '';
    case 'tracking_url':
      return ctx.trackingUrl ?? '';
    case 'checkout_url':
      return ctx.checkoutUrl ?? '';
    case 'fulfillment_status':
      return ctx.fulfillmentStatus ?? '';
    case 'shop_name':
      return ctx.shopName;
    default:
      return '';
  }
}
