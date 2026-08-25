import type { WooCommerceOrderPayload } from './types';

export function extractOrderPhone(order: WooCommerceOrderPayload): string | null {
  const phone = order.billing?.phone?.trim();
  return phone || null;
}

export function extractOrderEmail(order: WooCommerceOrderPayload): string | null {
  const email = order.billing?.email?.trim().toLowerCase();
  return email || null;
}
