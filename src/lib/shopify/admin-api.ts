import { phonesMatch } from '@/lib/whatsapp/phone-utils';

import { SHOPIFY_API_VERSION } from './config';
import { formatShopifyApiError } from './format-api-error';
import { normalizeShopDomain } from './normalize-shop';
import {
  shopifyCustomerSearchQueries,
  shopifyPhoneE164Variants,
  shopifyPhoneSearchVariants,
} from './phone-search';
import type {
  ShopifyAddressFields,
  ShopifyOrderPayload,
  ShopifyProductPayload,
} from './types';

export type { ShopifyProductPayload };
export interface ShopifyShopInfo {
  id: number;
  name: string;
  domain: string;
  myshopify_domain: string;
  email?: string;
  currency?: string;
}

export interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

export class ShopifyApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ShopifyApiError';
  }
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
  allowTokenRenewal = true,
): Promise<T> {
  const url = `${shopAdminBase(shopDomain)}${path}`;
  const request = (token: string) => fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      ...(init?.headers ?? {}),
    },
  });
  let response = await request(accessToken);
  if (response.status === 401 && allowTokenRenewal) {
    const { renewStoredShopifyToken } = await import('./token-renewal');
    const renewed = await renewStoredShopifyToken(shopDomain, accessToken);
    if (renewed) response = await request(renewed);
  }

  if (!response.ok) {
    let message = `Shopify API error: ${response.status}`;
    try {
      const body = await response.json();
      message = formatShopifyApiError(body, message);
    } catch {
      // keep fallback
    }
    throw new ShopifyApiError(message, response.status);
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export async function fetchShopInfo(
  shopDomain: string,
  accessToken: string,
  allowTokenRenewal = true,
): Promise<ShopifyShopInfo> {
  const data = await shopifyFetch<{ shop: ShopifyShopInfo }>(
    shopDomain,
    accessToken,
    '/shop.json',
    undefined,
    allowTokenRenewal,
  );
  return data.shop;
}

/** Full payloads for the flow variable sample browser, newest first. */
export async function fetchRecentOrderPayloads(shopDomain: string, accessToken: string): Promise<ShopifyOrderPayload[]> {
  const data = await shopifyFetch<{ orders: ShopifyOrderPayload[] }>(
    shopDomain, accessToken, '/orders.json?status=any&limit=5&order=created_at%20desc',
    { cache: 'no-store' },
  );
  return data.orders;
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
  'products/create',
  'products/update',
  'products/delete',
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
): Promise<ShopifyOrderPayload | null> {
  const data = await shopifyFetch<{ order?: ShopifyOrderPayload | null }>(
    shopDomain,
    accessToken,
    `/orders/${orderId}.json`,
    { cache: 'no-store' },
  );
  return data.order ?? null;
}

/** Counts come from Shopify, not the incomplete local order cache. */
export async function fetchConditionOrderCount(shopDomain: string, accessToken: string, customerId: string, createdBefore?: string): Promise<number> {
  if (!/^\d+$/.test(customerId)) throw new Error('Invalid Shopify customer ID');
  const { customer } = await shopifyFetch<{ customer?: { orders_count?: number } }>(shopDomain, accessToken, `/customers/${customerId}.json?fields=id,orders_count`);
  const lifetime = customer?.orders_count;
  if (lifetime == null || !Number.isInteger(lifetime) || lifetime < 0) throw new Error('Shopify customer order history is unavailable');
  if (!createdBefore) return lifetime;
  const base = shopAdminBase(shopDomain);
  let next: string | null = `${base}/customers/${customerId}/orders.json?status=any&limit=250&fields=id,created_at`;
  let visible = 0, previous = 0;
  const cutoff = Date.parse(createdBefore);
  for (let page = 0; next && page < 40; page++) {
    const response: Response = await fetch(next, { headers: { 'X-Shopify-Access-Token': accessToken }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Shopify customer history lookup failed (${response.status})`);
    const data = await response.json() as { orders?: Array<{ id: string | number; created_at: string }> };
    if (!Array.isArray(data.orders)) throw new Error('Invalid Shopify customer order history');
    visible += data.orders.length;
    previous += data.orders.filter(o => Date.parse(o.created_at) <= cutoff).length;
    // URLs can contain commas (e.g. fields=id,created_at). Parse the link target whole.
    const url: string | undefined = response.headers.get('link')?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
    if (url && (!url.startsWith(base + '/') || new URL(url).origin !== new URL(base).origin)) throw new Error('Invalid Shopify pagination URL');
    next = url ?? null;
  }
  // read_orders alone may only expose recent orders; never call that a lifetime count.
  if (next || visible < lifetime) throw new Error('Complete customer history is unavailable; historical order access may be required');
  return previous;
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

export interface ShopifyOrderPaymentState {
  cancelled: boolean;
  financialStatus: string;
  canMarkAsPaid: boolean;
  /** Outstanding balance in the shop currency, as a decimal string. */
  outstanding: string;
  currency: string;
}

/** Live payment state used for COD → prepaid conversion; never the webhook snapshot. */
export async function fetchOrderPaymentState(
  shopDomain: string,
  accessToken: string,
  orderId: string,
): Promise<ShopifyOrderPaymentState | null> {
  const data = await shopifyGraphql<{
    data?: {
      order?: {
        cancelledAt?: string | null;
        displayFinancialStatus?: string | null;
        canMarkAsPaid?: boolean;
        totalOutstandingSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
      } | null;
    };
  }>(
    shopDomain,
    accessToken,
    `query ($id: ID!) {
      order(id: $id) {
        cancelledAt
        displayFinancialStatus
        canMarkAsPaid
        totalOutstandingSet { shopMoney { amount currencyCode } }
      }
    }`,
    { id: `gid://shopify/Order/${orderId}` },
  );
  const order = data.data?.order;
  if (!order) return null;
  return {
    cancelled: Boolean(order.cancelledAt),
    financialStatus: order.displayFinancialStatus ?? '',
    canMarkAsPaid: order.canMarkAsPaid === true,
    outstanding: order.totalOutstandingSet?.shopMoney?.amount ?? '0',
    currency: order.totalOutstandingSet?.shopMoney?.currencyCode ?? '',
  };
}

type ShopifyUserErrors = { userErrors?: Array<{ message?: string }> } | null | undefined;

function throwUserErrors(result: ShopifyUserErrors): void {
  const message = result?.userErrors?.map((e) => e.message).filter(Boolean).join('; ');
  if (message) throw new Error(message);
}

/** Records the outstanding balance as paid (requires the write_orders scope). */
export async function markOrderAsPaid(
  shopDomain: string,
  accessToken: string,
  orderId: string,
): Promise<void> {
  const data = await shopifyGraphql<{ data?: { orderMarkAsPaid?: ShopifyUserErrors } }>(
    shopDomain,
    accessToken,
    `mutation ($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) { userErrors { field message } }
    }`,
    { input: { id: `gid://shopify/Order/${orderId}` } },
  );
  throwUserErrors(data.data?.orderMarkAsPaid);
}

export async function addOrderTags(
  shopDomain: string,
  accessToken: string,
  orderId: string,
  tags: string[],
): Promise<void> {
  if (!tags.length) return;
  const data = await shopifyGraphql<{ data?: { tagsAdd?: ShopifyUserErrors } }>(
    shopDomain,
    accessToken,
    `mutation ($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { id: `gid://shopify/Order/${orderId}`, tags },
  );
  throwUserErrors(data.data?.tagsAdd);
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
      // Require a real phone match — previously we also kept customers
      // with a missing phone, which leaked unrelated store orders into
      // address prefills (and then filtered to nothing).
      if (customerPhoneMatches(customer, phone)) {
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

/**
 * Shipping addresses from this contact's own recent Shopify orders only
 * (newest first, unique, capped). Scoped by `fetchOrdersByPhone` — no
 * store address book and no extra phone re-filter (Shopify order phones
 * often differ in trunk-0 / country-code formatting from WhatsApp).
 */
const MAX_RECENT_ADDRESSES = 3;

function addressFingerprint(addr: ShopifyAddressFields): string {
  return [
    addr.address1,
    addr.address2,
    addr.city,
    addr.zip,
    addr.province || addr.province_code,
    addr.country_code || addr.country,
  ]
    .map((p) => (typeof p === 'string' ? p.trim().toLowerCase() : ''))
    .join('|');
}

function pushUniqueAddress(
  into: ShopifyAddressFields[],
  addr: ShopifyAddressFields | null | undefined,
  seen: Set<string>,
): void {
  if (!addr || !(addr.address1 || addr.city || addr.zip)) return;
  if (into.length >= MAX_RECENT_ADDRESSES) return;
  const key = addressFingerprint(addr);
  if (!key || seen.has(key)) return;
  seen.add(key);
  into.push(addr);
}

/**
 * Recent shipping addresses for a single customer (by phone), taken
 * only from their Shopify orders — newest first, max 3 unique.
 */
export async function fetchCustomerAddressesByPhone(
  shopDomain: string,
  accessToken: string,
  phone: string,
): Promise<ShopifyAddressFields[]> {
  const collected: ShopifyAddressFields[] = [];
  const seen = new Set<string>();

  try {
    const orders = await fetchOrdersByPhone(shopDomain, accessToken, phone);
    const sorted = [...orders].sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });

    for (const order of sorted) {
      if (collected.length >= MAX_RECENT_ADDRESSES) break;
      // Prefer the shipping address on the order; only use billing when
      // shipping is missing so we stay tied to that order's delivery.
      if (order.shipping_address) {
        pushUniqueAddress(collected, order.shipping_address, seen);
      } else {
        pushUniqueAddress(collected, order.billing_address, seen);
      }
    }
  } catch (err) {
    console.warn('[shopify] recent order addresses failed:', err);
  }

  return collected.slice(0, MAX_RECENT_ADDRESSES);
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function shopifyFetchWithHeaders<T>(
  shopDomain: string,
  accessToken: string,
  path: string,
): Promise<{ body: T; linkHeader: string | null }> {
  const url = `${shopAdminBase(shopDomain)}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
  });

  if (!response.ok) {
    let message = `Shopify API error: ${response.status}`;
    try {
      const errorBody = await response.json();
      message = formatShopifyApiError(errorBody, message);
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }

  const body = (await response.json()) as T;
  return { body, linkHeader: response.headers.get('link') };
}

export interface FetchProductsPageArgs {
  shopDomain: string;
  accessToken: string;
  pageInfo?: string | null;
  status?: 'active' | 'archived' | 'draft';
  limit?: number;
}

export interface FetchProductsPageResult {
  products: ShopifyProductPayload[];
  nextPageInfo: string | null;
  shopCurrency: string | null;
}

/**
 * Paginated active products for catalog sync.
 * Uses Shopify cursor pagination via the Link response header.
 */
export async function fetchProductsPage(
  args: FetchProductsPageArgs,
): Promise<FetchProductsPageResult> {
  const limit = Math.min(Math.max(args.limit ?? 250, 1), 250);
  const status = args.status ?? 'active';

  const path = args.pageInfo
    ? `/products.json?limit=${limit}&page_info=${encodeURIComponent(args.pageInfo)}`
    : `/products.json?limit=${limit}&status=${status}`;

  const [{ body, linkHeader }, shopInfo] = await Promise.all([
    shopifyFetchWithHeaders<{ products?: ShopifyProductPayload[] }>(
      args.shopDomain,
      args.accessToken,
      path,
    ),
    args.pageInfo
      ? Promise.resolve(null)
      : fetchShopInfo(args.shopDomain, args.accessToken).catch(() => null),
  ]);

  return {
    products: body.products ?? [],
    nextPageInfo: parseNextPageInfo(linkHeader),
    shopCurrency: shopInfo?.currency ?? null,
  };
}

export interface ShopifyCollectionSummary {
  id: number;
  title: string;
  handle: string | null;
  kind: 'custom' | 'smart';
}

/** Manual (custom) and automated (smart) collections, merged and sorted by title. */
export async function fetchCollections(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyCollectionSummary[]> {
  type Row = { id?: number; title?: string; handle?: string };
  const [custom, smart] = await Promise.all([
    shopifyFetch<{ custom_collections?: Row[] }>(
      shopDomain,
      accessToken,
      '/custom_collections.json?limit=250&fields=id,title,handle',
    ),
    shopifyFetch<{ smart_collections?: Row[] }>(
      shopDomain,
      accessToken,
      '/smart_collections.json?limit=250&fields=id,title,handle',
    ),
  ]);

  const toSummary = (kind: 'custom' | 'smart') => (row: Row) =>
    row.id != null
      ? [{ id: row.id, title: row.title?.trim() || 'Untitled collection', handle: row.handle ?? null, kind }]
      : [];

  return [
    ...(custom.custom_collections ?? []).flatMap(toSummary('custom')),
    ...(smart.smart_collections ?? []).flatMap(toSummary('smart')),
  ].sort((a, b) => a.title.localeCompare(b.title));
}

/** Product ids in a collection, in the collection's sort order. */
export async function fetchCollectionProductIds(
  shopDomain: string,
  accessToken: string,
  collectionId: string | number,
): Promise<number[]> {
  const data = await shopifyFetch<{ products?: Array<{ id?: number }> }>(
    shopDomain,
    accessToken,
    `/collections/${encodeURIComponent(String(collectionId))}/products.json?limit=250&fields=id`,
  );
  return (data.products ?? []).flatMap((p) => (p.id != null ? [p.id] : []));
}
