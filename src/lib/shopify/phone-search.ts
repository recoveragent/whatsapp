import { normalizePhone, phoneVariants } from '@/lib/whatsapp/phone-utils';

/**
 * Phone strings to try with Shopify's `orders.json?phone=` filter.
 * WhatsApp contacts often use country code (e.g. 918454048066) while
 * Shopify may index the local number (8454048066).
 */
export function shopifyPhoneSearchVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const seen = new Set<string>();
  const push = (value: string) => {
    if (value.length >= 8) seen.add(value);
  };

  push(normalized);
  for (const variant of phoneVariants(normalized)) {
    push(variant);
  }

  if (normalized.length > 10) {
    push(normalized.slice(-10));
  }

  // India: strip leading 91 from 12-digit numbers.
  if (normalized.startsWith('91') && normalized.length >= 12) {
    const local = normalized.slice(2);
    push(local);
    if (local.startsWith('0')) {
      push(local.slice(1));
    }
  }

  return [...seen];
}

/**
 * E.164 (+prefix) variants for Shopify GraphQL `customerByIdentifier`.
 */
export function shopifyPhoneE164Variants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const seen = new Set<string>();
  const push = (digits: string) => {
    if (digits.length >= 8) seen.add(`+${digits}`);
  };

  push(normalized);

  // 10-digit Indian mobile → prepend country code 91.
  if (normalized.length === 10 && /^[6-9]/.test(normalized)) {
    push(`91${normalized}`);
  }

  if (normalized.startsWith('91') && normalized.length >= 12) {
    push(normalized);
    const local = normalized.slice(2);
    if (local.length === 10) push(`91${local}`);
  }

  for (const variant of phoneVariants(normalized)) {
    push(variant);
    if (variant.length === 10 && /^[6-9]/.test(variant)) {
      push(`91${variant}`);
    }
  }

  return [...seen];
}

/** `customers/search.json?query=` strings to try for a contact phone. */
export function shopifyCustomerSearchQueries(phone: string): string[] {
  const seen = new Set<string>();

  for (const variant of shopifyPhoneSearchVariants(phone)) {
    seen.add(`phone:+${variant}`);
    seen.add(`phone:${variant}`);
  }

  for (const e164 of shopifyPhoneE164Variants(phone)) {
    seen.add(`phone:${e164}`);
  }

  return [...seen];
}
