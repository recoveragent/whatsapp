import { phonesMatch } from '@/lib/whatsapp/phone-utils';

import { SHOPIFY_API_VERSION } from './config';
import { formatShopifyApiError } from './format-api-error';
import { normalizeShopDomain } from './normalize-shop';
import {
  shopifyCustomerSearchQueries,
  shopifyPhoneE164Variants,
  shopifyPhoneSearchVariants,
} from './phone-search';
import type { ShopifyAddressFields, ShopifyOrderPayload } from './types';
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

/**
 * Public image URL for a product (featured / first image).
 * REST order webhooks omit line-item images — callers use this fallback.
 */
export async function fetchProductImageUrl(
  shopDomain: string,
  accessToken: string,
  productId: string | number,
): Promise<string | null> {
  const data = await shopifyFetch<{
    product?: {
      image?: { src?: string } | null;
      images?: Array<{ src?: string }>;
    };
  }>(shopDomain, accessToken, `/products/${productId}.json`);

  const src =
    data.product?.image?.src?.trim() ||
    data.product?.images?.find((img) => img.src?.trim())?.src?.trim() ||
    null;
  return src || null;
}

/**
 * First line-item image on an order via GraphQL (image → variant → product).
 * Prefer this when an order id is available; REST order payloads lack images.
 */
export async function fetchFirstOrderProductImageUrl(
  shopDomain: string,
  accessToken: string,
  orderId: string | number,
): Promise<string | null> {
  const gid = `gid://shopify/Order/${orderId}`;
  try {
    const data = await shopifyGraphql<{
      data?: {
        order?: {
          lineItems?: {
            nodes?: Array<{
              image?: { url?: string } | null;
              variant?: { image?: { url?: string } | null } | null;
              product?: { featuredImage?: { url?: string } | null } | null;
            }>;
          };
        } | null;
      };
    }>(
      shopDomain,
      accessToken,
      `query ($id: ID!) {
        order(id: $id) {
          lineItems(first: 5) {
            nodes {
              image { url }
              variant { image { url } }
              product { featuredImage { url } }
            }
          }
        }
      }`,
      { id: gid },
    );

    for (const node of data.data?.order?.lineItems?.nodes ?? []) {
      const url =
        node.image?.url?.trim() ||
        node.variant?.image?.url?.trim() ||
        node.product?.featuredImage?.url?.trim() ||
        null;
      if (url) return url;
    }
  } catch (err) {
    console.warn('[shopify] fetchFirstOrderProductImageUrl failed:', orderId, err);
  }
  return null;
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

  const searchResults = await Promise.all(
    shopifyCustomerSearchQueries(phone).map(async (query) => {
      try {
        const data = await shopifyFetch<{ customers: ShopifyCustomerSearchHit[] }>(
          shopDomain,
          accessToken,
          `/customers/search.json?query=${encodeURIComponent(query)}&limit=10`,
        );
        return data.customers ?? [];
      } catch (err) {
        console.warn('[shopify] customer search failed:', query, err);
        return [] as ShopifyCustomerSearchHit[];
      }
    }),
  );

  for (const customers of searchResults) {
    for (const customer of customers) {
      const id = String(customer.id ?? '');
      if (!id) continue;
      if (customerPhoneMatches(customer, phone) || !customer.phone) {
        seen.add(id);
      }
    }
  }

  const graphqlResults = await Promise.all(
    shopifyPhoneE164Variants(phone).map(async (e164) => {
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
        return data.data?.customer?.id
          ? parseShopifyGid(data.data.customer.id)
          : null;
      } catch (err) {
        console.warn('[shopify] customerByIdentifier failed:', e164, err);
        return null;
      }
    }),
  );

  for (const numeric of graphqlResults) {
    if (numeric) seen.add(numeric);
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

  // Phone filter first (parallel variants) — usually enough; skip slow customer search when hit.
  const phoneResults = await Promise.all(
    shopifyPhoneSearchVariants(phone).map(async (variant) => {
      try {
        const data = await shopifyFetch<{ orders: ShopifyOrderPayload[] }>(
          shopDomain,
          accessToken,
          `/orders.json?status=any&phone=${encodeURIComponent(variant)}&limit=50`,
        );
        return data.orders ?? [];
      } catch (err) {
        console.warn('[shopify] fetchOrdersByPhone variant failed:', variant, err);
        return [] as ShopifyOrderPayload[];
      }
    }),
  );
  for (const orders of phoneResults) {
    mergeOrders(merged, seen, orders);
  }

  if (merged.length > 0) return merged;

  const customerIds = await searchCustomerIdsByPhone(shopDomain, accessToken, phone);
  const customerOrderResults = await Promise.all(
    customerIds.map(async (customerId) => {
      try {
        return await fetchOrdersByCustomerId(shopDomain, accessToken, customerId);
      } catch (err) {
        console.warn('[shopify] fetchOrdersByCustomerId failed:', customerId, err);
        return [] as ShopifyOrderPayload[];
      }
    }),
  );
  for (const orders of customerOrderResults) {
    mergeOrders(merged, seen, orders);
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

interface ShopifyCustomerDetail {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  default_address?: ShopifyAddressFields | null;
  addresses?: ShopifyAddressFields[] | null;
}

/**
 * Look up a Shopify customer by phone and return their saved addresses
 * (default + address book), newest-order shipping addresses first when
 * the address book is empty.
 *
 * Used by Collect-address flows to prefill Meta `saved_addresses`.
 * Failures are soft — returns [] so the form still sends blank.
 */
export async function fetchCustomerAddressesByPhone(
  shopDomain: string,
  accessToken: string,
  phone: string,
): Promise<ShopifyAddressFields[]> {
  const customerIds = await searchCustomerIdsByPhone(shopDomain, accessToken, phone);
  const collected: ShopifyAddressFields[] = [];

  for (const customerId of customerIds.slice(0, 3)) {
    try {
      const data = await shopifyFetch<{ customer: ShopifyCustomerDetail }>(
        shopDomain,
        accessToken,
        `/customers/${customerId}.json`,
      );
      const customer = data.customer;
      if (!customer) continue;

      const book = [
        ...(customer.default_address ? [customer.default_address] : []),
        ...(customer.addresses ?? []),
      ];
      for (const addr of book) {
        if (addr && (addr.address1 || addr.city || addr.zip)) {
          // Ensure name/phone fall through from the customer profile
          // when the address row omits them.
          collected.push({
            ...addr,
            first_name: addr.first_name || customer.first_name || undefined,
            last_name: addr.last_name || customer.last_name || undefined,
            phone: addr.phone || customer.phone || undefined,
          });
        }
      }
    } catch (err) {
      console.warn('[shopify] fetch customer addresses failed:', customerId, err);
    }
  }

  if (collected.length > 0) return collected;

  // Fallback: recent order shipping/billing addresses for this phone.
  try {
    const orders = await fetchOrdersByPhone(shopDomain, accessToken, phone);
    for (const order of orders.slice(0, 10)) {
      if (order.shipping_address) collected.push(order.shipping_address);
      else if (order.billing_address) collected.push(order.billing_address);
    }
  } catch (err) {
    console.warn('[shopify] order address fallback failed:', err);
  }

  return collected;
}
