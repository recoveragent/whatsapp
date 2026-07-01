import { SHOPIFY_API_VERSION } from './config';
import { formatShopifyApiError } from './format-api-error';
import { normalizeShopDomain } from './normalize-shop';
import { normalizePhone, phoneVariants } from '@/lib/whatsapp/phone-utils';
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

/** Search orders by customer phone (tries E.164 variants). */
export async function fetchOrdersByPhone(
  shopDomain: string,
  accessToken: string,
  phone: string,
): Promise<ShopifyOrderPayload[]> {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const seen = new Set<string>();
  const merged: ShopifyOrderPayload[] = [];

  for (const variant of phoneVariants(normalized)) {
    try {
      const data = await shopifyFetch<{ orders: ShopifyOrderPayload[] }>(
        shopDomain,
        accessToken,
        `/orders.json?status=any&phone=${encodeURIComponent(variant)}&limit=50`,
      );
      for (const order of data.orders ?? []) {
        const id = String(order.id ?? '');
        if (id && !seen.has(id)) {
          seen.add(id);
          merged.push(order);
        }
      }
    } catch (err) {
      console.warn('[shopify] fetchOrdersByPhone variant failed:', variant, err);
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
