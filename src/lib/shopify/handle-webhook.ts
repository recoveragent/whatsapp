import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchOrder } from './admin-api';
import {
  contextFromCheckout,
  contextFromFulfillment,
  contextFromOrder,
} from './extract-context';
import { loadCampaign, sendShopifyCampaign } from './send-campaign';
import { syncShopifyOrder } from './sync-order';
import {
  dispatchShopifyFlows,
  shopifyTopicToFlowTrigger,
} from '@/lib/flows/shopify-dispatch';
import type {
  ShopifyCheckoutPayload,
  ShopifyFulfillmentPayload,
  ShopifyOrderPayload,
} from './types';
import type { ShopifyFlowDispatchOutcome } from '@/lib/flows/shopify-dispatch';

interface ShopifyConfigLookup {
  account_id: string;
  user_id: string;
  shop_domain: string;
  access_token: string;
}

async function loadConfigByShop(
  db: SupabaseClient,
  shopDomain: string,
): Promise<ShopifyConfigLookup | null> {
  const normalized = shopDomain.toLowerCase();
  const { data, error } = await db
    .from('shopify_config')
    .select('account_id, user_id, shop_domain, access_token, status')
    .eq('shop_domain', normalized)
    .maybeSingle();

  if (error || !data || data.status !== 'connected') return null;
  return data as ShopifyConfigLookup;
}

function logFlowDispatch(
  topic: string,
  outcome: ShopifyFlowDispatchOutcome,
): void {
  console.info('[shopify webhook] flow dispatch', {
    topic,
    order: outcome.order_number,
    payment_status: outcome.payment_status,
    ok: outcome.ok,
    reason: outcome.reason,
    started: outcome.dispatch?.started.map((s) => s.flow_name) ?? [],
    skipped: outcome.dispatch?.skipped ?? [],
    no_active_flows: outcome.dispatch?.no_active_flows ?? false,
  });
}

export async function handleShopifyWebhook(args: {
  db: SupabaseClient;
  shopDomain: string;
  topic: string;
  payload: unknown;
}): Promise<void> {
  const config = await loadConfigByShop(args.db, args.shopDomain);
  if (!config) {
    console.warn('[shopify webhook] no config for shop:', args.shopDomain);
    return;
  }

  const shopName = config.shop_domain.replace('.myshopify.com', '');

  switch (args.topic) {
    case 'orders/create':
      await handleOrderCreate(args.db, config, args.payload as ShopifyOrderPayload, shopName);
      break;
    case 'orders/updated':
      await syncShopifyOrder(args.db, config.account_id, args.payload as ShopifyOrderPayload, shopName);
      {
        const order = args.payload as ShopifyOrderPayload;
        const trigger = shopifyTopicToFlowTrigger(args.topic, {
          cancelled_at: order.cancelled_at,
          fulfillment_status: order.fulfillment_status,
        });
        if (trigger) {
          const ctx = contextFromOrder(order, shopName);
          const outcome = await dispatchShopifyFlows({
            db: args.db,
            accountId: config.account_id,
            ownerUserId: config.user_id,
            triggerType: trigger,
            context: ctx,
          });
          logFlowDispatch(args.topic, outcome);
        }
      }
      break;
    case 'fulfillments/create':
    case 'fulfillments/update':
      await handleFulfillment(
        args.db,
        config,
        args.payload as ShopifyFulfillmentPayload,
        shopName,
        args.topic,
      );
      break;
    case 'checkouts/create':
      await handleCheckoutCreate(args.db, config, args.payload as ShopifyCheckoutPayload, shopName);
      break;
    case 'checkouts/update':
      await handleCheckoutUpdate(args.db, config, args.payload as ShopifyCheckoutPayload);
      break;
    default:
      break;
  }
}

async function handleOrderCreate(
  db: SupabaseClient,
  config: ShopifyConfigLookup,
  order: ShopifyOrderPayload,
  shopName: string,
) {
  await syncShopifyOrder(db, config.account_id, order, shopName);

  const context = contextFromOrder(order, shopName);

  const campaign = await loadCampaign(db, config.account_id, 'order_confirmation');
  if (campaign) {
    const result = await sendShopifyCampaign({
      db,
      accountId: config.account_id,
      ownerUserId: config.user_id,
      campaign,
      context,
    });

    if (!result.ok && result.error !== 'already sent') {
      console.warn('[shopify] order_confirmation:', result.error);
    }
  }

  const outcome = await dispatchShopifyFlows({
    db,
    accountId: config.account_id,
    ownerUserId: config.user_id,
    triggerType: 'shopify_order_placed',
    context,
  });
  logFlowDispatch('orders/create', outcome);
}

async function handleFulfillment(
  db: SupabaseClient,
  config: ShopifyConfigLookup,
  fulfillment: ShopifyFulfillmentPayload,
  shopName: string,
  topic: string,
) {
  let order: ShopifyOrderPayload | null = null;
  if (fulfillment.order_id) {
    try {
      const accessToken = decrypt(config.access_token);
      order = (await fetchOrder(
        config.shop_domain,
        accessToken,
        fulfillment.order_id,
      )) as ShopifyOrderPayload;
      if (order) {
        await syncShopifyOrder(db, config.account_id, order, shopName);
      }
    } catch (err) {
      console.warn('[shopify] fetch order for fulfillment failed:', err);
    }
  }

  const context = contextFromFulfillment(fulfillment, order, shopName);

  const campaign = await loadCampaign(db, config.account_id, 'fulfillment_update');
  if (campaign) {
    const result = await sendShopifyCampaign({
      db,
      accountId: config.account_id,
      ownerUserId: config.user_id,
      campaign,
      context,
    });

    if (!result.ok && result.error !== 'already sent') {
      console.warn('[shopify] fulfillment_update:', result.error);
    }
  }

  const trigger = shopifyTopicToFlowTrigger(topic, {
    fulfillment_status: order?.fulfillment_status,
  });
  if (trigger) {
    const outcome = await dispatchShopifyFlows({
      db,
      accountId: config.account_id,
      ownerUserId: config.user_id,
      triggerType: trigger,
      context,
    });
    logFlowDispatch(topic, outcome);
  }
}

async function handleCheckoutCreate(
  db: SupabaseClient,
  config: ShopifyConfigLookup,
  checkout: ShopifyCheckoutPayload,
  shopName: string,
) {
  if (checkout.completed_at) return;

  const campaign = await loadCampaign(db, config.account_id, 'abandoned_checkout');
  if (!campaign?.is_enabled) return;

  const context = contextFromCheckout(checkout, shopName);
  const checkoutId = String(checkout.id ?? checkout.token ?? '');
  if (!checkoutId) return;

  const runAt = new Date(
    Date.now() + (campaign.delay_minutes ?? 60) * 60 * 1000,
  ).toISOString();

  const { error } = await db.from('shopify_pending_checkouts').upsert(
    {
      account_id: config.account_id,
      checkout_id: checkoutId,
      payload: checkout,
      status: 'pending',
      run_at: runAt,
    },
    { onConflict: 'account_id,checkout_id' },
  );

  if (error) {
    console.error('[shopify] schedule abandoned checkout failed:', error);
  }

  void context;
}

async function handleCheckoutUpdate(
  db: SupabaseClient,
  config: ShopifyConfigLookup,
  checkout: ShopifyCheckoutPayload,
) {
  const checkoutId = String(checkout.id ?? checkout.token ?? '');
  if (!checkoutId) return;

  if (checkout.completed_at) {
    await db
      .from('shopify_pending_checkouts')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('account_id', config.account_id)
      .eq('checkout_id', checkoutId)
      .eq('status', 'pending');
  }
}

export async function processDueAbandonedCheckouts(db: SupabaseClient): Promise<number> {
  const { data: due, error } = await db
    .from('shopify_pending_checkouts')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50);

  if (error || !due?.length) return 0;

  let processed = 0;

  for (const row of due) {
    const { data: claim } = await db
      .from('shopify_pending_checkouts')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (!claim) continue;

    const accountId = row.account_id as string;
    const checkout = row.payload as ShopifyCheckoutPayload;

    if (checkout.completed_at) {
      await db
        .from('shopify_pending_checkouts')
        .update({ status: 'cancelled' })
        .eq('id', row.id);
      continue;
    }

    const { data: config } = await db
      .from('shopify_config')
      .select('user_id, shop_domain, status')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config || config.status !== 'connected') {
      await db
        .from('shopify_pending_checkouts')
        .update({ status: 'failed', error_message: 'shopify not connected' })
        .eq('id', row.id);
      continue;
    }

    const campaign = await loadCampaign(db, accountId, 'abandoned_checkout');
    if (!campaign?.is_enabled || !campaign.template_name) {
      await db
        .from('shopify_pending_checkouts')
        .update({ status: 'cancelled', error_message: 'campaign disabled' })
        .eq('id', row.id);
      continue;
    }

    const shopName = (config.shop_domain as string).replace('.myshopify.com', '');
    const context = contextFromCheckout(checkout, shopName);

    const result = await sendShopifyCampaign({
      db,
      accountId,
      ownerUserId: config.user_id as string,
      campaign,
      context,
    });

    await db
      .from('shopify_pending_checkouts')
      .update({
        status: result.ok || result.error === 'already sent' ? 'sent' : 'failed',
        error_message: result.ok ? null : result.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    processed++;
  }

  return processed;
}
