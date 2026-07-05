import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchShopifyFlows } from '@/lib/flows/shopify-dispatch';
import type { FlowTriggerType } from '@/lib/flows/trigger-types';
import { fetchOrder } from '@/lib/shopify/admin-api';
import { contextFromOrder } from '@/lib/shopify/extract-context';
import { syncShopifyOrder } from '@/lib/shopify/sync-order';
import type { ShopifyOrderPayload } from '@/lib/shopify/types';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * POST /api/shopify/orders/trigger-flow
 *
 * Manually replay Shopify order-placed flow dispatch for an order
 * (e.g. when the webhook never reached the app).
 */
export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await req.json().catch(() => null)) as
      | {
          contact_id?: string;
          shopify_order_id?: string;
          trigger_type?: FlowTriggerType;
        }
      | null;

    if (!body?.contact_id?.trim() || !body?.shopify_order_id?.trim()) {
      return NextResponse.json(
        { error: 'contact_id and shopify_order_id are required' },
        { status: 400 },
      );
    }

    const contactId = body.contact_id.trim();
    const shopifyOrderId = body.shopify_order_id.trim();
    const triggerType = body.trigger_type ?? 'shopify_order_placed';

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (contactErr || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const db = supabaseAdmin();
    const { data: config, error: configErr } = await db
      .from('shopify_config')
      .select('user_id, shop_domain, access_token, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configErr || !config || config.status !== 'connected' || !config.access_token) {
      return NextResponse.json(
        { error: 'Shopify is not connected for this account' },
        { status: 422 },
      );
    }

    const shopDomain = config.shop_domain as string;
    const accessToken = decrypt(config.access_token as string);
    const order = (await fetchOrder(
      shopDomain,
      accessToken,
      shopifyOrderId,
    )) as ShopifyOrderPayload | null;

    if (!order?.id) {
      return NextResponse.json({ error: 'Order not found in Shopify' }, { status: 404 });
    }

    const shopName = shopDomain.replace('.myshopify.com', '');
    await syncShopifyOrder(db, ctx.accountId, order, shopName);

    const eventContext = contextFromOrder(order, shopName);
    const outcome = await dispatchShopifyFlows({
      db,
      accountId: ctx.accountId,
      ownerUserId: config.user_id as string,
      triggerType,
      context: eventContext,
    });

    return NextResponse.json({
      ok: outcome.ok,
      reason: outcome.reason,
      order_number: outcome.order_number,
      payment_status: outcome.payment_status,
      dispatch: outcome.dispatch,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
