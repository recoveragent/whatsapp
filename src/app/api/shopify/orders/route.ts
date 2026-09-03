import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { fetchOrdersByEmail, fetchOrdersByPhone } from '@/lib/shopify/admin-api';
import {
  filterCachedOrdersForContact,
  filterLiveOrdersForContact,
} from '@/lib/shopify/match-order-contact';
import { syncShopifyOrder } from '@/lib/shopify/sync-order';
import { hasShopifyOrdersTable } from '@/lib/inbox/tables';
import {
  buildShopifyAdminOrderUrl,
  deriveShopifyOrderStatus,
  extractOrderStatusUrl,
  extractOrderTracking,
} from '@/lib/shopify/order-links';
import { orderInboxDisplayFields } from '@/lib/shopify/extract-context';
import {
  enrichCachedOrdersFromShopify,
  hydrateLiveOrderPayloads,
  ordersNeedInboxDisplayEnrichment,
} from '@/lib/shopify/enrich-inbox-orders';
import {
  applyLatestShipmentStatuses,
  loadLatestShipmentStatuses,
  ordersNeedTrackingRefresh,
} from '@/lib/shopify/fulfillment-shipment-status';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { ShopifyOrder } from '@/types';
import type { ShopifyOrderPayload } from '@/lib/shopify/types';

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function mapLiveOrder(
  order: ShopifyOrderPayload,
  accountId: string,
  contactId: string,
  shopDomain: string | null,
): ShopifyOrder {
  const paymentGateway = Array.isArray(order.payment_gateway_names)
    ? order.payment_gateway_names[0] ?? null
    : null;
  const tracking = extractOrderTracking(order);
  const inboxFields = orderInboxDisplayFields(order);
  const shopifyOrderId = String(order.id);

  return {
    id: `live-${order.id}`,
    account_id: accountId,
    contact_id: contactId,
    customer_phone: null,
    shopify_order_id: shopifyOrderId,
    order_number: order.name ?? (order.order_number != null ? `#${order.order_number}` : shopifyOrderId),
    total_price: order.total_price ?? null,
    currency: order.currency ?? null,
    payment_status: order.financial_status ?? null,
    payment_gateway: paymentGateway,
    order_status: deriveShopifyOrderStatus(order),
    product_title: inboxFields.product_title,
    shipping_address: inboxFields.shipping_address,
    fulfillment_status: order.fulfillment_status ?? 'unfulfilled',
    shipment_status: tracking.shipment_status,
    tracking_url: tracking.tracking_url,
    tracking_number: tracking.tracking_number,
    order_status_url: extractOrderStatusUrl(order),
    admin_url: shopDomain ? buildShopifyAdminOrderUrl(shopDomain, shopifyOrderId) : null,
    tags: parseTags(order.tags),
    ordered_at: order.created_at ?? null,
    created_at: order.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function enrichOrders(orders: ShopifyOrder[], shopDomain: string | null): ShopifyOrder[] {
  if (!shopDomain) return orders;
  return orders.map((order) => ({
    ...order,
    admin_url: buildShopifyAdminOrderUrl(shopDomain, order.shopify_order_id),
  }));
}

async function backfillShipmentStatusFromEvents(
  accountId: string,
  orders: ShopifyOrder[],
): Promise<ShopifyOrder[]> {
  if (!ordersNeedTrackingRefresh(orders)) return orders;

  const db = supabaseAdmin();
  const latest = await loadLatestShipmentStatuses(
    db,
    accountId,
    orders.map((order) => order.shopify_order_id),
  );
  return applyLatestShipmentStatuses(orders, latest);
}

async function loadShopDomain(accountId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('shopify_config')
    .select('shop_domain, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!data || data.status !== 'connected') return null;
  return data.shop_domain as string;
}

function matchOrdersByPhone(orders: ShopifyOrder[], phone: string): ShopifyOrder[] {
  return orders.filter(
    (o) => Boolean(o.customer_phone && phonesMatch(o.customer_phone, phone)),
  );
}

async function linkVerifiedOrders(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  orders: ShopifyOrder[],
): Promise<void> {
  const ids = orders
    .filter((o) => o.contact_id !== contactId)
    .map((o) => o.id);
  if (ids.length === 0) return;

  await db
    .from('shopify_orders')
    .update({ contact_id: contactId, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .in('id', ids);
}

async function loadCachedOrders(
  accountId: string,
  contactId: string,
  phone: string | null,
): Promise<ShopifyOrder[]> {
  const db = supabaseAdmin();
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  // Phone-first: map Shopify orders to this inbox contact by number.
  if (normalizedPhone) {
    const suffix = normalizedPhone.length >= 10
      ? normalizedPhone.slice(-10)
      : normalizedPhone.length >= 8
        ? normalizedPhone.slice(-8)
        : normalizedPhone;

    const { data: candidates, error: candidateErr } = await db
      .from('shopify_orders')
      .select('*')
      .eq('account_id', accountId)
      .not('customer_phone', 'is', null)
      .like('customer_phone', `%${suffix}`)
      .order('ordered_at', { ascending: false })
      .limit(100);

    if (candidateErr) throw candidateErr;

    const matched = matchOrdersByPhone((candidates ?? []) as ShopifyOrder[], normalizedPhone);
    if (matched.length > 0) {
      await linkVerifiedOrders(db, accountId, contactId, matched);
      return matched;
    }
  }

  const { data: linked, error: linkedErr } = await db
    .from('shopify_orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('ordered_at', { ascending: false })
    .limit(50);

  if (linkedErr) throw linkedErr;

  return filterCachedOrdersForContact((linked ?? []) as ShopifyOrder[], phone, contactId);
}

async function loadShopifyCredentials(accountId: string): Promise<{
  shopDomain: string;
  accessToken: string;
  shopName: string;
} | null> {
  const db = supabaseAdmin();
  const { data: config, error: configErr } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (configErr || !config || config.status !== 'connected' || !config.access_token) {
    return null;
  }

  const shopDomain = config.shop_domain as string;
  return {
    shopDomain,
    accessToken: decrypt(config.access_token as string),
    shopName: shopDomain.replace('.myshopify.com', ''),
  };
}

async function fetchLiveShopifyOrders(args: {
  accountId: string;
  phone: string | null;
  email: string | null;
}): Promise<ShopifyOrderPayload[]> {
  const credentials = await loadShopifyCredentials(args.accountId);
  if (!credentials) return [];

  const { shopDomain, accessToken } = credentials;

  let liveOrders = args.phone
    ? await fetchOrdersByPhone(shopDomain, accessToken, args.phone)
    : [];

  if (liveOrders.length === 0 && args.email) {
    liveOrders = await fetchOrdersByEmail(shopDomain, accessToken, args.email);
  }

  const filtered = filterLiveOrdersForContact(liveOrders, args.phone, args.email);
  if (filtered.length === 0) return [];

  return hydrateLiveOrderPayloads(shopDomain, accessToken, filtered);
}

async function persistLiveShopifyOrders(args: {
  accountId: string;
  contactId: string;
  liveOrders: ShopifyOrderPayload[];
}): Promise<void> {
  if (args.liveOrders.length === 0) return;

  const credentials = await loadShopifyCredentials(args.accountId);
  if (!credentials) return;

  const db = supabaseAdmin();
  await Promise.all(
    args.liveOrders.map((order) =>
      syncShopifyOrder(db, args.accountId, order, credentials.shopName),
    ),
  );

  await db
    .from('shopify_orders')
    .update({ contact_id: args.contactId, updated_at: new Date().toISOString() })
    .eq('account_id', args.accountId)
    .in('shopify_order_id', args.liveOrders.map((o) => String(o.id)));
}

async function syncLiveShopifyOrders(args: {
  accountId: string;
  contactId: string;
  phone: string | null;
  email: string | null;
}): Promise<ShopifyOrderPayload[]> {
  const liveOrders = await fetchLiveShopifyOrders(args);
  if (liveOrders.length === 0) return [];

  await persistLiveShopifyOrders({
    accountId: args.accountId,
    contactId: args.contactId,
    liveOrders,
  });

  return liveOrders;
}

export async function GET(req: Request) {
  try {
    const ctx = await getCurrentAccount();
    const contactId = new URL(req.url).searchParams.get('contact_id');

    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id, phone, email')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (contactErr || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const [hasTable, shopDomain] = await Promise.all([
      hasShopifyOrdersTable(),
      loadShopDomain(ctx.accountId),
    ]);

    if (hasTable) {
      let orders = await loadCachedOrders(
        ctx.accountId,
        contactId,
        contact.phone,
      );
      orders = await backfillShipmentStatusFromEvents(ctx.accountId, orders);

      let liveOrders: ShopifyOrderPayload[] = [];
      const needsLive =
        orders.length === 0 ||
        ordersNeedInboxDisplayEnrichment(orders) ||
        ordersNeedTrackingRefresh(orders);

      if (needsLive) {
        try {
          liveOrders = await syncLiveShopifyOrders({
            accountId: ctx.accountId,
            contactId,
            phone: contact.phone,
            email: contact.email ?? null,
          });
          orders = await loadCachedOrders(
            ctx.accountId,
            contactId,
            contact.phone,
          );
          orders = await backfillShipmentStatusFromEvents(ctx.accountId, orders);

          // Sync wrote rows but cache match missed — return live map once (no second Shopify fetch).
          if (orders.length === 0 && liveOrders.length > 0) {
            return NextResponse.json({
              orders: liveOrders.map((order) =>
                mapLiveOrder(order, ctx.accountId, contactId, shopDomain),
              ),
            });
          }
        } catch (err) {
          console.warn('[shopify/orders] live sync failed:', err);
        }
      }

      if (
        ordersNeedInboxDisplayEnrichment(orders) ||
        ordersNeedTrackingRefresh(orders)
      ) {
        try {
          const enriched = await enrichCachedOrdersFromShopify(
            ctx.accountId,
            orders,
            loadShopifyCredentials,
            async (accountId) =>
              fetchLiveShopifyOrders({
                accountId,
                phone: contact.phone,
                email: contact.email ?? null,
              }),
          );
          orders = enriched.orders;
          if (enriched.liveOrders.length > 0) {
            liveOrders = enriched.liveOrders;
            await persistLiveShopifyOrders({
              accountId: ctx.accountId,
              contactId,
              liveOrders: enriched.liveOrders,
            }).catch((err) => {
              console.warn('[shopify/orders] persist enriched orders failed:', err);
            });
          }
        } catch (err) {
          console.warn('[shopify/orders] cached order enrich failed:', err);
        }
      }

      return NextResponse.json({ orders: enrichOrders(orders, shopDomain) });
    }

    const liveOrders = await fetchLiveShopifyOrders({
      accountId: ctx.accountId,
      phone: contact.phone,
      email: contact.email ?? null,
    });

    return NextResponse.json({
      orders: liveOrders.map((order) =>
        mapLiveOrder(order, ctx.accountId, contactId, shopDomain),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
