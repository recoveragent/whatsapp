import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { fetchOrdersByEmail, fetchOrdersByPhone } from '@/lib/shopify/admin-api';
import { syncShopifyOrder } from '@/lib/shopify/sync-order';
import { hasShopifyOrdersTable } from '@/lib/inbox/tables';
import {
  buildShopifyAdminOrderUrl,
  extractOrderTracking,
} from '@/lib/shopify/order-links';
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
    fulfillment_status: order.fulfillment_status ?? 'unfulfilled',
    tracking_url: tracking.tracking_url,
    tracking_number: tracking.tracking_number,
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

async function loadCachedOrders(
  accountId: string,
  contactId: string,
  normalizedPhone: string | null,
): Promise<ShopifyOrder[]> {
  const db = supabaseAdmin();

  if (normalizedPhone) {
    const suffix = normalizedPhone.length >= 8 ? normalizedPhone.slice(-8) : normalizedPhone;
    await db
      .from('shopify_orders')
      .update({ contact_id: contactId, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .is('contact_id', null)
      .like('customer_phone', `%${suffix}`);
  }

  const { data: byContact, error: byContactErr } = await db
    .from('shopify_orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('ordered_at', { ascending: false })
    .limit(50);

  if (byContactErr) throw byContactErr;
  if ((byContact?.length ?? 0) > 0) return byContact ?? [];

  if (!normalizedPhone) return [];

  const suffix = normalizedPhone.length >= 8 ? normalizedPhone.slice(-8) : normalizedPhone;
  const { data: candidates, error: candidateErr } = await db
    .from('shopify_orders')
    .select('*')
    .eq('account_id', accountId)
    .like('customer_phone', `%${suffix}`)
    .order('ordered_at', { ascending: false })
    .limit(100);

  if (candidateErr) throw candidateErr;

  const matched = matchOrdersByPhone(candidates ?? [], normalizedPhone);
  if (matched.length > 0) {
    const ids = matched.filter((o) => !o.contact_id).map((o) => o.id);
    if (ids.length > 0) {
      await db
        .from('shopify_orders')
        .update({ contact_id: contactId, updated_at: new Date().toISOString() })
        .in('id', ids);
    }
  }

  return matched;
}

async function fetchLiveShopifyOrders(args: {
  accountId: string;
  contactId: string;
  phone: string | null;
  email: string | null;
}): Promise<ShopifyOrderPayload[]> {
  const db = supabaseAdmin();

  const { data: config, error: configErr } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (configErr || !config || config.status !== 'connected' || !config.access_token) {
    return [];
  }

  const shopDomain = config.shop_domain as string;
  const accessToken = decrypt(config.access_token as string);

  let liveOrders = args.phone
    ? await fetchOrdersByPhone(shopDomain, accessToken, args.phone)
    : [];

  if (liveOrders.length === 0 && args.email) {
    liveOrders = await fetchOrdersByEmail(shopDomain, accessToken, args.email);
  }

  return liveOrders;
}

async function syncLiveShopifyOrders(args: {
  accountId: string;
  contactId: string;
  phone: string | null;
  email: string | null;
}): Promise<void> {
  const liveOrders = await fetchLiveShopifyOrders(args);
  if (liveOrders.length === 0) return;

  const db = supabaseAdmin();
  const { data: config } = await db
    .from('shopify_config')
    .select('shop_domain')
    .eq('account_id', args.accountId)
    .maybeSingle();

  const shopName = ((config?.shop_domain as string) ?? '').replace('.myshopify.com', '');

  for (const order of liveOrders) {
    await syncShopifyOrder(db, args.accountId, order, shopName);
  }

  await db
    .from('shopify_orders')
    .update({ contact_id: args.contactId, updated_at: new Date().toISOString() })
    .eq('account_id', args.accountId)
    .in('shopify_order_id', liveOrders.map((o) => String(o.id)));
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

    const normalizedPhone = contact.phone ? normalizePhone(contact.phone) : null;
    const hasTable = await hasShopifyOrdersTable();
    const shopDomain = await loadShopDomain(ctx.accountId);

    if (hasTable) {
      let orders = await loadCachedOrders(ctx.accountId, contactId, normalizedPhone);

      if (orders.length === 0) {
        try {
          await syncLiveShopifyOrders({
            accountId: ctx.accountId,
            contactId,
            phone: contact.phone,
            email: contact.email ?? null,
          });
          orders = await loadCachedOrders(ctx.accountId, contactId, normalizedPhone);
        } catch (err) {
          console.warn('[shopify/orders] live sync failed:', err);
        }
      }

      return NextResponse.json({ orders: enrichOrders(orders, shopDomain) });
    }

    const liveOrders = await fetchLiveShopifyOrders({
      accountId: ctx.accountId,
      contactId,
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
