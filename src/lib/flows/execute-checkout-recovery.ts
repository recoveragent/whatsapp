import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowRunRow, FlowNodeRow } from './types';
import type { CheckoutRecoveryNodeConfig } from './checkout-recovery-config';
import {
  prepareRecoveryOrder,
  completeRecoveryOrder,
} from '@/lib/shopify/recovery-orders';

export async function executeCheckoutRecovery(
  db: SupabaseClient,
  run: FlowRunRow,
  node: FlowNodeRow
): Promise<string> {
  const c = node.config as unknown as CheckoutRecoveryNodeConfig;
  try {
    if (c.action === 'prepare_cod' && c.cod_mode === 'checkout') {
      const url = new URL(String(run.vars.checkout_url ?? ''));
      if (url.protocol !== 'https:')
        throw new Error('A secure checkout URL is required.');
      return c.checkout_next;
    }
    const order =
      c.action === 'prepare_cod'
        ? await prepareRecoveryOrder(db, run)
        : await completeRecoveryOrder(
            db,
            String(run.vars.checkout_recovery_id ?? ''),
            run.account_id,
            { run }
          );
    run.vars = {
      ...run.vars,
      checkout_recovery_id: order.id,
      checkout_order_summary: order.summary,
      checkout_amount: (Number(order.amount_paise) / 100).toFixed(2),
      ...(order.shopify_order_id
        ? {
            shopify_order_id: order.shopify_order_id,
            order_number: order.order_name,
          }
        : {}),
      checkout_recovery_error: null,
    };
    const { error } = await db
      .from('flow_runs')
      .update({ vars: run.vars })
      .eq('id', run.id)
      .eq('account_id', run.account_id);
    if (error) throw error;
    return c.ready_next;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Checkout recovery failed.';
    run.vars = { ...run.vars, checkout_recovery_error: detail };
    await db
      .from('flow_runs')
      .update({ vars: run.vars })
      .eq('id', run.id)
      .eq('account_id', run.account_id);
    await db
      .from('flow_run_events')
      .insert({
        flow_run_id: run.id,
        node_key: node.node_key,
        event_type: 'error',
        payload: { reason: 'checkout_recovery_failed', detail },
      });
    // Only preparation failures can fall back to checkout. A completion may have
    // reached Shopify even if its response was lost; never invite another order.
    if (
      c.action === 'prepare_cod' &&
      !/already|in progress|another recovery/i.test(detail)
    ) {
      try {
        if (new URL(String(run.vars.checkout_url)).protocol === 'https:')
          return c.checkout_next;
      } catch {
        /* No usable checkout link: ask a human to assist. */
      }
    }
    return c.failed_next;
  }
}
