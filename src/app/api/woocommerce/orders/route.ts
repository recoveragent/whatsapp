import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  buildWooCommerceAdminOrderUrl,
  fetchOrdersByEmail,
  fetchOrdersByPhone,
} from '@/lib/woocommerce/admin-api';
import { syncWooCommerceOrder } from '@/lib/woocommerce/sync-order';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { WooCommerceOrder } from '@/types';
import type { WooCommerceOrderPayload } from '@/lib/woocommerce/types';

function mapLiveOrder(
  order: WooCommerceOrderPayload,
  accountId: string,
  contactId: string,
  storeUrl: string | null,
): WooCommerceOrder {
  return {
    id: `live-${order.id}`,
    account_id: accountId,
    contact_id: contactId,
    customer_phone: order.billing?.phone ?? null,
    woocommerce_order_id: String(order.id),
    order_number: order.number ? `#${order.number}` : `#${order.id}`,
    total_price: order.total ?? null,
    currency: order.currency ?? null,
    payment_status: order.status ?? null,
    payment_gateway: order.payment_method_title ?? order.payment_method ?? null,
    fulfillment_status: order.status === 'completed' ? 'fulfilled' : (order.status ?? 'unfulfilled'),
    order_status_url: null,
    admin_url: storeUrl ? buildWooCommerceAdminOrderUrl(storeUrl, order.id) : null,
    tags: [],
    ordered_at: order.date_created ?? order.date_created_gmt ?? null,
    created_at: order.date_created ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function enrichOrders(orders: WooCommerceOrder[], storeUrl: string | null): WooCommerceOrder[] {
  if (!storeUrl) return orders;
  return orders.map((order) => ({
    ...order,
    admin_url: buildWooCommerceAdminOrderUrl(storeUrl, order.woocommerce_order_id),
  }));
}

async function loadStoreUrl(accountId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('woocommerce_config')
    .select('store_url, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!data || data.status !== 'connected') return null;
  return data.store_url as string;
}

function matchOrdersByPhone(orders: WooCommerceOrder[], phone: string): WooCommerceOrder[] {
  return orders.filter(
    (o) => Boolean(o.customer_phone && phonesMatch(o.customer_phone, phone)),
  );
}

async function linkVerifiedOrders(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  orders: WooCommerceOrder[],
): Promise<void> {
  const ids = orders.filter((o) => o.contact_id !== contactId).map((o) => o.id);
  if (ids.length === 0) return;

  await db
    .from('woocommerce_orders')
    .update({ contact_id: contactId, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .in('id', ids);
}

async function loadCachedOrders(
  accountId: string,
  contactId: string,
  phone: string | null,
): Promise<WooCommerceOrder[]> {
  const db = supabaseAdmin();
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  if (normalizedPhone) {
    const suffix =
      normalizedPhone.length >= 10
        ? normalizedPhone.slice(-10)
        : normalizedPhone.length >= 8
          ? normalizedPhone.slice(-8)
          : normalizedPhone;

    const { data: candidates, error: candidateErr } = await db
      .from('woocommerce_orders')
      .select('*')
      .eq('account_id', accountId)
      .not('customer_phone', 'is', null)
      .like('customer_phone', `%${suffix}`)
      .order('ordered_at', { ascending: false })
      .limit(100);

    if (candidateErr) throw candidateErr;

    const matched = matchOrdersByPhone((candidates ?? []) as WooCommerceOrder[], normalizedPhone);
    if (matched.length > 0) {
      await linkVerifiedOrders(db, accountId, contactId, matched);
      return matched;
    }
  }

  const { data: linked, error: linkedErr } = await db
    .from('woocommerce_orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('ordered_at', { ascending: false })
    .limit(50);

  if (linkedErr) throw linkedErr;
  return (linked ?? []) as WooCommerceOrder[];
}

async function fetchLiveOrders(args: {
  accountId: string;
  phone: string | null;
  email: string | null;
}): Promise<WooCommerceOrderPayload[]> {
  const db = supabaseAdmin();

  const { data: config, error: configErr } = await db
    .from('woocommerce_config')
    .select('store_url, consumer_key, consumer_secret, status')
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (configErr || !config || config.status !== 'connected') return [];

  const consumerKey = decrypt(config.consumer_key as string);
  const consumerSecret = decrypt(config.consumer_secret as string);
  const storeUrl = config.store_url as string;

  let liveOrders = args.phone
    ? await fetchOrdersByPhone(storeUrl, consumerKey, consumerSecret, args.phone)
    : [];

  if (liveOrders.length === 0 && args.email) {
    liveOrders = await fetchOrdersByEmail(storeUrl, consumerKey, consumerSecret, args.email);
  }

  return liveOrders;
}

async function syncLiveOrders(args: {
  accountId: string;
  contactId: string;
  phone: string | null;
  email: string | null;
}): Promise<WooCommerceOrderPayload[]> {
  const liveOrders = await fetchLiveOrders(args);
  if (liveOrders.length === 0) return [];

  const db = supabaseAdmin();
  const { data: config } = await db
    .from('woocommerce_config')
    .select('store_url')
    .eq('account_id', args.accountId)
    .maybeSingle();

  const storeUrl = (config?.store_url as string) ?? '';

  await Promise.all(
    liveOrders.map((order) => syncWooCommerceOrder(db, args.accountId, order, storeUrl)),
  );

  await db
    .from('woocommerce_orders')
    .update({ contact_id: args.contactId, updated_at: new Date().toISOString() })
    .eq('account_id', args.accountId)
    .in('woocommerce_order_id', liveOrders.map((o) => String(o.id)));

  return liveOrders;
}

export async function GET(req: Request) {
  try {
    const ctx = await getCurrentAccount();

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

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

    const storeUrl = await loadStoreUrl(ctx.accountId);

    let orders = await loadCachedOrders(ctx.accountId, contactId, contact.phone);

    if (orders.length === 0) {
      try {
        const liveOrders = await syncLiveOrders({
          accountId: ctx.accountId,
          contactId,
          phone: contact.phone,
          email: contact.email ?? null,
        });
        orders = await loadCachedOrders(ctx.accountId, contactId, contact.phone);

        if (orders.length === 0 && liveOrders.length > 0) {
          return NextResponse.json({
            orders: liveOrders.map((order) =>
              mapLiveOrder(order, ctx.accountId, contactId, storeUrl),
            ),
          });
        }
      } catch (err) {
        console.warn('[woocommerce/orders] live sync failed:', err);
      }
    }

    return NextResponse.json({ orders: enrichOrders(orders, storeUrl) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
