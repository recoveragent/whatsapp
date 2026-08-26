import type { WooCommerceCustomerPayload } from './types';

export function extractCustomerPhone(customer: WooCommerceCustomerPayload): string | null {
  const phone = customer.billing?.phone?.trim();
  return phone || null;
}

export function extractCustomerEmail(customer: WooCommerceCustomerPayload): string | null {
  const email = (customer.email ?? customer.billing?.email)?.trim().toLowerCase();
  return email || null;
}

export function extractCustomerName(customer: WooCommerceCustomerPayload): string | null {
  const billingName = [customer.billing?.first_name, customer.billing?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (billingName) return billingName;

  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

export function extractCustomerSince(customer: WooCommerceCustomerPayload): string | null {
  return customer.date_created ?? customer.date_created_gmt ?? null;
}

export function extractBillingLocation(customer: WooCommerceCustomerPayload): {
  country: string | null;
  state: string | null;
  city: string | null;
} {
  return {
    country: customer.billing?.country?.trim() || null,
    state: customer.billing?.state?.trim() || null,
    city: customer.billing?.city?.trim() || null,
  };
}
