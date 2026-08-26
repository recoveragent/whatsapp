import type { SupabaseClient } from '@supabase/supabase-js';

import { syncWooCommerceOrder } from './sync-order';
import { syncWooCommerceCustomer } from './sync-customer';
import { contextFromOrder } from './extract-event-context';
import {
  dispatchWooCommerceFlows,
  type WooCommerceFlowDispatchOutcome,
} from '@/lib/flows/woocommerce-dispatch';
import { woocommerceTopicToFlowTrigger } from '@/lib/flows/trigger-types';
import type { WooCommerceCustomerPayload, WooCommerceOrderPayload } from './types';
import { normalizeStoreUrl } from './normalize-store-url';

interface WooCommerceConfigLookup {
  account_id: string;
  user_id: string;
  store_url: string;
  status: string;
}

async function loadConfigByStore(
  db: SupabaseClient,
  storeUrl: string,
): Promise<WooCommerceConfigLookup | null> {
  const normalized = normalizeStoreUrl(storeUrl);
  if (!normalized) return null;

  const { data, error } = await db
    .from('woocommerce_config')
    .select('account_id, user_id, store_url, status')
    .eq('store_url', normalized)
    .maybeSingle();

  if (error || !data || data.status !== 'connected') return null;
  return data as WooCommerceConfigLookup;
}

function logFlowDispatch(
  topic: string,
  outcome: WooCommerceFlowDispatchOutcome,
): void {
  console.info('[woocommerce webhook] flow dispatch', {
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

export async function handleWooCommerceWebhook(args: {
  db: SupabaseClient;
  storeUrl: string;
  topic: string;
  payload: unknown;
}): Promise<void> {
  const config = await loadConfigByStore(args.db, args.storeUrl);
  if (!config) {
    console.warn('[woocommerce webhook] no config for store:', args.storeUrl);
    return;
  }

  switch (args.topic) {
    case 'order.created':
    case 'order.updated': {
      const order = args.payload as WooCommerceOrderPayload;
      if (!order?.id) return;
      await syncWooCommerceOrder(args.db, config.account_id, order, config.store_url, config.user_id);

      const trigger = woocommerceTopicToFlowTrigger(args.topic, {
        status: order.status,
      });
      if (trigger) {
        const context = contextFromOrder(order, config.store_url);
        const outcome = await dispatchWooCommerceFlows({
          db: args.db,
          accountId: config.account_id,
          ownerUserId: config.user_id,
          triggerType: trigger,
          context,
        });
        logFlowDispatch(args.topic, outcome);
      } else {
        console.info('[woocommerce webhook] synced order', {
          topic: args.topic,
          order: order.number ?? order.id,
          store: config.store_url,
        });
      }
      break;
    }
    case 'customer.created':
    case 'customer.updated': {
      const customer = args.payload as WooCommerceCustomerPayload;
      if (!customer?.id) return;

      const result = await syncWooCommerceCustomer({
        db: args.db,
        accountId: config.account_id,
        ownerUserId: config.user_id,
        customer,
      });

      console.info('[woocommerce webhook] customer sync', {
        topic: args.topic,
        customer_id: customer.id,
        ok: result.ok,
        skipped: result.skipped,
        store: config.store_url,
      });
      break;
    }
    default:
      console.info('[woocommerce webhook] ignored topic:', args.topic);
  }
}
