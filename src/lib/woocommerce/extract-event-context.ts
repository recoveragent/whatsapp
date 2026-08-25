import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { buildWooCommerceOrderStatusUrl } from './admin-api';
import { extractOrderEmail, extractOrderPhone } from './extract-context';
import type { WooCommerceEventContext, WooCommerceOrderPayload } from './types';

function fullName(first?: string, last?: string): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

function formatLineItems(
  items: WooCommerceOrderPayload['line_items'],
): string | null {
  if (!items?.length) return null;
  return items
    .map((item) => {
      const label = item.name ?? 'Item';
      const qty = item.quantity ?? 1;
      return qty > 1 ? `${label} ×${qty}` : label;
    })
    .join(', ');
}

function formatMoney(amount: string | undefined, currency: string | undefined): string | null {
  if (!amount) return null;
  return currency ? `${amount} ${currency}` : amount;
}

function mapFulfillmentStatus(status: string | undefined): string {
  if (!status) return 'unfulfilled';
  if (status === 'completed') return 'fulfilled';
  return status;
}

export function contextFromOrder(
  order: WooCommerceOrderPayload,
  storeUrl: string,
): WooCommerceEventContext {
  const phoneRaw = extractOrderPhone(order);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const customerName =
    fullName(order.billing?.first_name, order.billing?.last_name) || null;
  const storeName = storeUrl.replace(/^https?:\/\//, '').split('/')[0] ?? storeUrl;

  return {
    resourceKey: `order:${order.id}`,
    phone: phone && phone.length >= 8 ? phone : null,
    customerName,
    email: extractOrderEmail(order),
    orderNumber: order.number ? `#${order.number}` : `#${order.id}`,
    orderTotal: formatMoney(order.total, order.currency),
    orderItems: formatLineItems(order.line_items),
    paymentStatus: order.status ?? null,
    fulfillmentStatus: mapFulfillmentStatus(order.status),
    orderStatusUrl: buildWooCommerceOrderStatusUrl(storeUrl, order.id, order.order_key),
    storeName,
  };
}
