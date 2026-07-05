import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { ShopifyOrder } from '@/types';

import { extractOrderPhone, extractOrderEmail } from './extract-context';
import type { ShopifyOrderPayload } from './types';

/**
 * True when a live Shopify order belongs to this inbox contact.
 *
 * Orders returned by Shopify's `phone` / `email` query are accepted when
 * the payload has no phone/email fields (common on Indian COD orders).
 * We only reject when extractable fields clearly conflict.
 */
export function orderPayloadMatchesContact(
  order: ShopifyOrderPayload,
  contactPhone: string | null | undefined,
  contactEmail: string | null | undefined,
): boolean {
  const orderPhone = extractOrderPhone(order);
  const orderEmail = extractOrderEmail(order);

  if (contactPhone && orderPhone && !phonesMatch(contactPhone, orderPhone)) {
    return false;
  }

  const email = contactEmail?.trim().toLowerCase();
  const normalizedOrderEmail = orderEmail?.trim().toLowerCase();
  if (email && normalizedOrderEmail && email !== normalizedOrderEmail) {
    return false;
  }

  if (contactPhone && orderPhone && phonesMatch(contactPhone, orderPhone)) {
    return true;
  }
  if (email && normalizedOrderEmail && email === normalizedOrderEmail) {
    return true;
  }

  // Shopify search matched but payload omits phone/email.
  if (!orderPhone && !orderEmail) {
    return true;
  }

  if (contactPhone && !orderPhone) {
    return true;
  }

  return false;
}

export function cachedOrderMatchesContact(
  order: ShopifyOrder,
  contactPhone: string | null | undefined,
  contactId: string,
): boolean {
  if (order.contact_id === contactId && !order.customer_phone) {
    return true;
  }
  if (contactPhone && order.customer_phone && phonesMatch(contactPhone, order.customer_phone)) {
    return true;
  }
  return false;
}

export function filterCachedOrdersForContact(
  orders: ShopifyOrder[],
  contactPhone: string | null | undefined,
  contactId: string,
): ShopifyOrder[] {
  return orders.filter((order) => cachedOrderMatchesContact(order, contactPhone, contactId));
}

export function filterLiveOrdersForContact(
  orders: ShopifyOrderPayload[],
  contactPhone: string | null | undefined,
  contactEmail: string | null | undefined,
): ShopifyOrderPayload[] {
  return orders.filter((order) =>
    orderPayloadMatchesContact(order, contactPhone, contactEmail),
  );
}
