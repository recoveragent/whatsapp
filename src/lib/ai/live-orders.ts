import { SHOPIFY_API_VERSION } from '@/lib/shopify/config';
import { shopifyPhoneSearchVariants } from '@/lib/shopify/phone-search';
import {
  extractOrderPhone,
  orderInboxDisplayFields,
} from '@/lib/shopify/extract-context';
import {
  deriveShopifyOrderStatus,
  extractOrderStatusUrl,
  extractOrderTracking,
} from '@/lib/shopify/order-links';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { aiOrderPhoneMatches } from './order-identity';
import type { ShopifyOrderPayload } from '@/lib/shopify/types';
import type { ShopifyOrder } from '@/types';

/** Bounded, read-only lookup. The phone is loaded from the account's contact,
 * never from customer-supplied message text or an unverified order number.
 * Uses the same REST integration/version as the existing Shopify order sync.
 * Search results are independently verified before any data enters a prompt.
 */
export async function loadLiveAiOrders(args: {
  shopDomain: string;
  accessToken: string;
  phone: string;
  accountId: string;
  contactId: string;
}): Promise<ShopifyOrder[]> {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(args.shopDomain)) {
    throw new Error('Invalid Shopify host');
  }
  const normalized = normalizePhone(args.phone);
  const variants = [
    ...new Set([
      normalized,
      ...(/^91[6-9]\d{9}$/.test(normalized) ? [normalized.slice(2)] : []),
      ...shopifyPhoneSearchVariants(args.phone),
    ]),
  ]
    .filter((phone) => phone.length >= 8)
    .slice(0, 3);
  if (!variants.length) return [];
  // One shared deadline covers all requests AND body reads, with cancellation.
  const signal = AbortSignal.timeout(5_000);
  const results = await Promise.allSettled(
    variants.map(async (phone) => {
      const url = new URL(
        `https://${args.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`
      );
      url.search = new URLSearchParams({
        status: 'any',
        phone,
        limit: '50',
      }).toString();
      const response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': args.accessToken },
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
      if (!response.ok) throw new Error('Shopify order lookup unavailable');
      const body = (await response.json()) as {
        orders?: ShopifyOrderPayload[];
      };
      if (!Array.isArray(body.orders))
        throw new Error('Invalid Shopify order response');
      return body.orders;
    })
  );
  if (results.every((result) => result.status === 'rejected')) {
    throw new Error('Shopify order lookup unavailable');
  }
  const orders = new Map<string, ShopifyOrder>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const order of result.value) {
      const phone = extractOrderPhone(order);
      // Redacted/missing identity is not evidence of ownership.
      if (!order.id || !phone || !aiOrderPhoneMatches(phone, args.phone))
        continue;
      const id = String(order.id);
      const tracking = extractOrderTracking(order);
      const fields = orderInboxDisplayFields(order);
      const now = new Date().toISOString();
      orders.set(id, {
        id: `live-${id}`,
        account_id: args.accountId,
        contact_id: args.contactId,
        customer_phone: phone,
        shopify_order_id: id,
        order_number: order.name ?? `#${order.order_number ?? id}`,
        total_price: order.current_total_price ?? order.total_price ?? null,
        currency: order.currency ?? null,
        payment_status: order.financial_status ?? null,
        payment_gateway: null,
        order_status: deriveShopifyOrderStatus(order),
        product_title: fields.product_title,
        shipping_address: null,
        fulfillment_status: order.fulfillment_status ?? 'unfulfilled',
        shipment_status: tracking.shipment_status,
        tracking_url: tracking.tracking_url,
        tracking_number: tracking.tracking_number,
        order_status_url: extractOrderStatusUrl(order),
        admin_url: null,
        tags: [],
        ordered_at: order.created_at ?? null,
        created_at: order.created_at ?? now,
        updated_at: now,
      });
    }
  }
  return [...orders.values()].sort((a, b) =>
    (b.ordered_at ?? '').localeCompare(a.ordered_at ?? '')
  );
}
