import type {
  WooCommerceCustomerPayload,
  WooCommerceOrderPayload,
  WooCommerceWebhookRow,
} from './types';
import { normalizeStoreUrl } from './normalize-store-url';
import { WOOCOMMERCE_API_VERSION } from './config';

function buildAuthHeader(consumerKey: string, consumerSecret: string): string {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  return `Basic ${token}`;
}

function apiBase(storeUrl: string): string {
  const normalized = normalizeStoreUrl(storeUrl);
  if (!normalized) throw new Error('Invalid store URL');
  return `${normalized}/wp-json/${WOOCOMMERCE_API_VERSION}`;
}

async function wooFetch<T>(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${apiBase(storeUrl)}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(consumerKey, consumerSecret),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      body ? `WooCommerce API error (${res.status}): ${body.slice(0, 200)}` : `WooCommerce API error (${res.status})`,
    );
  }

  return (await res.json()) as T;
}

export async function verifyWooCommerceCredentials(args: {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}): Promise<{ store_name: string; store_url: string }> {
  await wooFetch<WooCommerceOrderPayload[]>(
    args.storeUrl,
    args.consumerKey,
    args.consumerSecret,
    '/orders?per_page=1',
  );

  const normalized = normalizeStoreUrl(args.storeUrl);
  if (!normalized) throw new Error('Invalid store URL');

  let storeName = normalized.replace(/^https?:\/\//, '');
  try {
    const res = await fetch(`${normalized}/wp-json`, { cache: 'no-store' });
    if (res.ok) {
      const meta = (await res.json()) as { name?: string };
      if (meta.name?.trim()) storeName = meta.name.trim();
    }
  } catch {
    // Non-fatal — credentials verified via orders endpoint.
  }

  return { store_name: storeName, store_url: normalized };
}

const WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'customer.created',
  'customer.updated',
] as const;

export async function registerWooCommerceWebhooks(args: {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  callbackUrl: string;
  webhookSecret: string;
}): Promise<void> {
  const existing = await wooFetch<WooCommerceWebhookRow[]>(
    args.storeUrl,
    args.consumerKey,
    args.consumerSecret,
    '/webhooks?per_page=100',
  );

  for (const topic of WEBHOOK_TOPICS) {
    const match = existing.find(
      (hook) => hook.topic === topic && hook.delivery_url === args.callbackUrl,
    );

    if (match?.id) {
      await wooFetch<WooCommerceWebhookRow>(
        args.storeUrl,
        args.consumerKey,
        args.consumerSecret,
        `/webhooks/${match.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            secret: args.webhookSecret,
            status: 'active',
          }),
        },
      );
      continue;
    }

    await wooFetch<WooCommerceWebhookRow>(
      args.storeUrl,
      args.consumerKey,
      args.consumerSecret,
      '/webhooks',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `WACRM ${topic}`,
          topic,
          delivery_url: args.callbackUrl,
          secret: args.webhookSecret,
          status: 'active',
        }),
      },
    );
  }
}

export async function fetchOrder(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  orderId: number | string,
): Promise<WooCommerceOrderPayload> {
  return wooFetch<WooCommerceOrderPayload>(
    storeUrl,
    consumerKey,
    consumerSecret,
    `/orders/${orderId}`,
  );
}

export async function fetchOrdersByPhone(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  phone: string,
): Promise<WooCommerceOrderPayload[]> {
  const digits = phone.replace(/\D/g, '');
  const suffix = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!suffix) return [];

  return wooFetch<WooCommerceOrderPayload[]>(
    storeUrl,
    consumerKey,
    consumerSecret,
    `/orders?search=${encodeURIComponent(suffix)}&per_page=20&orderby=date&order=desc`,
  );
}

export async function fetchOrdersByEmail(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  email: string,
): Promise<WooCommerceOrderPayload[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  return wooFetch<WooCommerceOrderPayload[]>(
    storeUrl,
    consumerKey,
    consumerSecret,
    `/orders?search=${encodeURIComponent(normalized)}&per_page=20&orderby=date&order=desc`,
  );
}

export async function fetchCustomersPage(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  page: number,
  perPage = 100,
): Promise<WooCommerceCustomerPayload[]> {
  return wooFetch<WooCommerceCustomerPayload[]>(
    storeUrl,
    consumerKey,
    consumerSecret,
    `/customers?per_page=${perPage}&page=${page}&orderby=registered_date&order=asc`,
  );
}

export async function fetchCustomersTotal(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
): Promise<number> {
  const url = `${apiBase(storeUrl)}/customers?per_page=1&page=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: buildAuthHeader(consumerKey, consumerSecret),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      body
        ? `WooCommerce API error (${res.status}): ${body.slice(0, 200)}`
        : `WooCommerce API error (${res.status})`,
    );
  }

  const totalHeader = res.headers.get('x-wp-total');
  if (totalHeader) {
    const n = Number.parseInt(totalHeader, 10);
    if (Number.isFinite(n)) return n;
  }

  const rows = (await res.json()) as WooCommerceCustomerPayload[];
  return rows.length;
}

export async function fetchCustomer(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  customerId: number | string,
): Promise<WooCommerceCustomerPayload> {
  return wooFetch<WooCommerceCustomerPayload>(
    storeUrl,
    consumerKey,
    consumerSecret,
    `/customers/${customerId}`,
  );
}

export function buildWooCommerceAdminOrderUrl(storeUrl: string, orderId: string | number): string {
  const normalized = normalizeStoreUrl(storeUrl);
  if (!normalized) return '';
  return `${normalized}/wp-admin/post.php?post=${orderId}&action=edit`;
}

export function buildWooCommerceOrderStatusUrl(
  storeUrl: string,
  orderId: string | number,
  orderKey?: string | null,
): string | null {
  const normalized = normalizeStoreUrl(storeUrl);
  if (!normalized) return null;
  if (orderKey) {
    return `${normalized}/checkout/order-received/${orderId}/?key=${orderKey}`;
  }
  return `${normalized}/my-account/view-order/${orderId}/`;
}
