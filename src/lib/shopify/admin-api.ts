import { phonesMatch } from '@/lib/whatsapp/phone-utils';

import { SHOPIFY_API_VERSION } from './config';
import { formatShopifyApiError } from './format-api-error';
import { normalizeShopDomain } from './normalize-shop';
import {
  shopifyCustomerSearchQueries,
  shopifyPhoneE164Variants,
  shopifyPhoneSearchVariants,
} from './phone-search';
import type { ShopifyOrderPayload } from './types';
export interface ShopifyShopInfo {
  id: number;
  name: string;
  domain: string;
  myshopify_domain: string;
  email?: string;
}

export interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

function shopAdminBase(shopDomain: string): string {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) throw new Error('Invalid shop domain');
  return `https://${normalized}/admin/api/${SHOPIFY_API_VERSION}`;
}

async function shopifyFetch<T>(
  shopDomain: string,
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${shopAdminBase(shopDomain)}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Shopify API error: ${response.status}`;
    try {
      const body = await response.json();
      message = formatShopifyApiError(body, message);
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export async function fetchShopInfo(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyShopInfo> {
  const data = await shopifyFetch<{ shop: ShopifyShopInfo }>(
    shopDomain,
    accessToken,
    '/shop.json',
  );
  return data.shop;
}

export async function exchangeOAuthCode(args: {
  shopDomain: string;
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<ShopifyTokenResponse> {
  const shop = normalizeShopDomain(args.shopDomain);
  if (!shop) throw new Error('Invalid shop domain');

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
    }),
  });

  if (!response.ok) {
    let message = `OAuth token exchange failed: ${response.status}`;
    try {
      const body = await response.json();
      message = formatShopifyApiError(body, message);
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }
  return response.json() as Promise<ShopifyTokenResponse>;
}

const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'fulfillments/create',
  'fulfillments/update',
  'checkouts/create',
  'checkouts/update',
] as const;

export async function registerShopifyWebhooks(args: {
  shopDomain: string;
  accessToken: string;
  callbackUrl: string;
}): Promise<void> {
  const existing = await shopifyFetch<{ webhooks: Array<{ id: number; topic: string; address: string }> }>(
    args.shopDomain,
    args.accessToken,
    '/webhooks.json',
  );

  const registered = new Set(
    (existing.webhooks ?? [])
      .filter((w) => w.address === args.callbackUrl)
      .map((w) => w.topic),
  );

  for (const topic of WEBHOOK_TOPICS) {
    if (registered.has(topic)) continue;
    await shopifyFetch(args.shopDomain, args.accessToken, '/webhooks.json', {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          topic,
          address: args.callbackUrl,
          format: 'json',
        },
      }),
    });
  }
}

export async function fetchOrder(
  shopDomain: string,
  accessToken: string,
  orderId: string | number,
) {
  const data = await shopifyFetch<{ order: unknown }>(
    shopDomain,
    accessToken,
    `/orders/${orderId}.json`,
  );
  return data.order;
}

function parseShopifyGid(gid: string): string | null {
  const match = gid.match(/\/(\d+)$/);
  return match?.[1] ?? null;
}

function mergeOrders(
  target: ShopifyOrderPayload[],
  seen: Set<string>,
  orders: ShopifyOrderPayload[],
): void {
  for (const order of orders) {
    const id = String(order.id ?? '');
    if (id && !seen.has(id)) {
      seen.add(id);
      target.push(order);
    }
  }
}

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) throw new Error('Invalid shop domain');

  const url = `https://${normalized}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    let message = `Shopify GraphQL error: ${response.status}`;
    try {
      const body = await response.json();
      message = formatShopifyApiError(body, message);
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }

  const body = (await response.json()) as T & { errors?: Array<{ message?: string }> };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const message = body.errors.map((e) => e.message).filter(Boolean).join('; ');
    throw new Error(message || 'Shopify GraphQL request failed');
  }

  return body;
}

interface ShopifyCustomerSearchHit {
  id: number;
  phone?: string | null;
  default_address?: { phone?: string | null } | null;
}

function customerPhoneMatches(
  customer: ShopifyCustomerSearchHit,
  contactPhone: string,
): boolean {
  const candidates = [
    customer.phone,
    customer.default_address?.phone,
  ];
  return candidates.some(
    (raw) => typeof raw === 'string' && raw.length > 0 && phonesMatch(raw, contactPhone),
  );
}

async function searchCustomerIdsByPhone(
  shopDomain: string,
  accessToken: string,
  phone: string,
): Promise<string[]> {
  const seen = new Set<string>();

  for (const query of shopifyCustomerSearchQueries(phone)) {
    try {
      const data = await shopifyFetch<{ customers: ShopifyCustomerSearchHit[] }>(
        shopDomain,
        accessToken,
        `/customers/search.json?query=${encodeURIComponent(query)}&limit=10`,
      );
      for (const customer of data.customers ?? []) {
        const id = String(customer.id ?? '');
        if (!id) continue;
        if (customerPhoneMatches(customer, phone) || !customer.phone) {
          seen.add(id);
        }
      }
    } catch (err) {
      console.warn('[shopify] customer search failed:', query, err);
    }
  }

  for (const e164 of shopifyPhoneE164Variants(phone)) {
    try {
      const data = await shopifyGraphql<{
        data?: { customer?: { id?: string } | null };
      }>(
        shopDomain,
        accessToken,
        `query($identifier: CustomerIdentifierInput!) {
          customer: customerByIdentifier(identifier: $identifier) {
            id
          }
        }`,
        { identifier: { phoneNumber: e164 } },
      );
      const numeric = data.data?.customer?.id
        ? parseShopifyGid(data.data.customer.id)
        : null;
      if (numeric) seen.add(numeric);
    } catch (err) {
      console.warn('[shopify] customerByIdentifier failed:', e164, err);
    }
  }

  return [...seen];
}

async function fetchOrdersByCustomerId(
  shopDomain: string,
  accessToken: string,
  customerId: string,
): Promise<ShopifyOrderPayload[]> {
  const data = await shopifyFetch<{ orders: ShopifyOrderPayload[] }>(
    shopDomain,
    accessToken,
    `/customers/${customerId}/orders.json?status=any&limit=50`,
  );
  return data.orders ?? [];
}

/** Search orders by customer phone (REST, customer search, and GraphQL). */
export async function fetchOrdersByPhone(
  shopDomain: string,
  accessToken: string,
  phone: string,
): Promise<ShopifyOrderPayload[]> {
  const seen = new Set<string>();
  const merged: ShopifyOrderPayload[] = [];

  for (const variant of shopifyPhoneSearchVariants(phone)) {
    try {
      const data = await shopifyFetch<{ orders: ShopifyOrderPayload[] }>(
        shopDomain,
        accessToken,
        `/orders.json?status=any&phone=${encodeURIComponent(variant)}&limit=50`,
      );
      mergeOrders(merged, seen, data.orders ?? []);
    } catch (err) {
      console.warn('[shopify] fetchOrdersByPhone variant failed:', variant, err);
    }
  }

  const customerIds = await searchCustomerIdsByPhone(shopDomain, accessToken, phone);
  for (const customerId of customerIds) {
    try {
      const orders = await fetchOrdersByCustomerId(shopDomain, accessToken, customerId);
      mergeOrders(merged, seen, orders);
    } catch (err) {
      console.warn('[shopify] fetchOrdersByCustomerId failed:', customerId, err);
    }
  }

  return merged;
}

/** Search orders by customer email. */
export async function fetchOrdersByEmail(
  shopDomain: string,
  accessToken: string,
  email: string,
): Promise<ShopifyOrderPayload[]> {
  const trimmed = email.trim();
  if (!trimmed) return [];

  const data = await shopifyFetch<{ orders: ShopifyOrderPayload[] }>(
    shopDomain,
    accessToken,
    `/orders.json?status=any&email=${encodeURIComponent(trimmed)}&limit=50`,
  );
  return data.orders ?? [];
}
