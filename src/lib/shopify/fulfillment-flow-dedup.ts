import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Claim a one-time dispatch slot for this flow + order + shipment status.
 * Returns false when the same combination was already handled.
 */
export async function claimShopifyFulfillmentFlowDispatch(args: {
  db: SupabaseClient;
  accountId: string;
  flowId: string;
  orderKey: string;
  shipmentStatusKey: string;
  flowRunId?: string;
}): Promise<boolean> {
  const orderKey = args.orderKey.trim();
  if (!orderKey) return true;

  const { data, error } = await args.db
    .from('shopify_flow_fulfillment_log')
    .insert({
      account_id: args.accountId,
      flow_id: args.flowId,
      order_key: orderKey,
      shipment_status_key: args.shipmentStatusKey,
      flow_run_id: args.flowRunId ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return false;
    console.warn('[shopify] fulfillment flow dedupe insert failed:', error.message);
    return true;
  }

  return Boolean(data);
}

export async function attachFlowRunToFulfillmentDispatch(args: {
  db: SupabaseClient;
  accountId: string;
  flowId: string;
  orderKey: string;
  shipmentStatusKey: string;
  flowRunId: string;
}): Promise<void> {
  const orderKey = args.orderKey.trim();
  if (!orderKey) return;

  const { error } = await args.db
    .from('shopify_flow_fulfillment_log')
    .update({ flow_run_id: args.flowRunId })
    .eq('account_id', args.accountId)
    .eq('flow_id', args.flowId)
    .eq('order_key', orderKey)
    .eq('shipment_status_key', args.shipmentStatusKey);

  if (error) {
    console.warn('[shopify] fulfillment flow dedupe attach failed:', error.message);
  }
}

export async function releaseShopifyFulfillmentFlowDispatch(args: {
  db: SupabaseClient;
  accountId: string;
  flowId: string;
  orderKey: string;
  shipmentStatusKey: string;
}): Promise<void> {
  const orderKey = args.orderKey.trim();
  if (!orderKey) return;

  const { error } = await args.db
    .from('shopify_flow_fulfillment_log')
    .delete()
    .eq('account_id', args.accountId)
    .eq('flow_id', args.flowId)
    .eq('order_key', orderKey)
    .eq('shipment_status_key', args.shipmentStatusKey)
    .is('flow_run_id', null);

  if (error) {
    console.warn('[shopify] fulfillment flow dedupe release failed:', error.message);
  }
}

export function fulfillmentOrderKeyFromVars(
  vars: Record<string, unknown> | null | undefined,
): string {
  const orderNumber = vars?.order_number;
  if (typeof orderNumber === 'string' && orderNumber.trim()) {
    return orderNumber.trim();
  }
  const shopifyOrderId = vars?.shopify_order_id;
  if (shopifyOrderId != null && String(shopifyOrderId).trim()) {
    return String(shopifyOrderId).trim();
  }
  return '';
}
