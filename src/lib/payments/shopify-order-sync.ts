import 'server-only';
import { completeRecoveryOrder } from '@/lib/shopify/recovery-orders';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  addOrderTags,
  fetchOrderPaymentState,
  markOrderAsPaid,
} from '@/lib/shopify/admin-api';
import {
  DEFAULT_SHOPIFY_PAID_TAG,
  type CollectPaymentNodeConfig,
} from '@/lib/flows/payment-config';
import type { FlowRunRow } from '@/lib/flows/types';

const MAX_SYNC_ATTEMPTS = 8;

/** 5 min, doubling, capped at 6 h — about 16 h of retries in total. */
function retryDelayMs(attempts: number): number {
  return Math.min(5 * 2 ** (attempts - 1), 360) * 60_000;
}

function toPaise(amount: string): number {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

async function shopifyConnection(db: SupabaseClient, accountId: string) {
  const { data, error } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'connected')
    throw new Error('Connect this brand’s Shopify store to convert COD orders.');
  return {
    shop: data.shop_domain as string,
    token: decrypt(data.access_token as string),
  };
}

function shopifyOrderId(run: FlowRunRow): string {
  // Webhook payloads may send the Admin GraphQL id (gid://shopify/Order/123).
  const id = String(run.vars?.shopify_order_id ?? '')
    .trim()
    .replace(/^gid:\/\/shopify\/Order\//, '');
  if (!/^\d+$/.test(id))
    throw new Error(
      'COD to prepaid needs a Shopify order from the flow trigger. Webhook triggers must send shopify_order_id.'
    );
  return id;
}

/**
 * The amount to collect for COD → prepaid: the order's live outstanding
 * balance. Refuses cancelled, already-paid and non-INR orders.
 */
export async function codOrderCollection(
  db: SupabaseClient,
  run: FlowRunRow
): Promise<{ amount: number; orderId: string }> {
  const orderId = shopifyOrderId(run);
  const { shop, token } = await shopifyConnection(db, run.account_id);
  const state = await fetchOrderPaymentState(shop, token, orderId);
  if (!state) throw new Error('The Shopify order could not be found.');
  if (state.cancelled)
    throw new Error('The Shopify order is cancelled; no payment was requested.');
  if (state.currency !== 'INR')
    throw new Error('COD to prepaid supports INR Shopify orders only.');
  const paise = toPaise(state.outstanding);
  if (!(paise >= 100))
    throw new Error('The Shopify order has no outstanding balance to collect.');
  return { amount: paise / 100, orderId };
}

function syncErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Shopify order update failed';
  if (/access denied|write_orders|ACCESS_DENIED|\b403\b/i.test(message))
    return 'Shopify denied the order update. Reconnect Shopify and approve order write access (write_orders).';
  return message;
}

interface SyncRow {
  id: string;
  account_id: string;
  flow_run_id: string;
  node_key: string;
  amount_paise: number;
  status: string;
  config: CollectPaymentNodeConfig;
  shopify_order_id: string;
  shopify_sync_status: string;
  shopify_sync_attempts: number;
  shopify_sync_next_at: string | null;
checkout_recovery_id?: string | null;
}

export type ShopifySyncResult = 'synced' | 'failed' | 'retry' | 'not_due';

/**
 * Marks a paid COD collection's Shopify order as paid. Safe to call from
 * webhooks and overlapping cron workers: each attempt is claimed first and the
 * live order is re-read, so an order is never marked twice or past its balance.
 */
export async function syncShopifyOrderPayment(
  db: SupabaseClient,
  requestId: string
): Promise<ShopifySyncResult> {
  const { data, error } = await db
    .from('flow_payment_requests')
    .select(
      'id, account_id, flow_run_id, node_key, amount_paise, status, config, shopify_order_id, shopify_sync_status, shopify_sync_attempts, shopify_sync_next_at, checkout_recovery_id'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  const row = data as SyncRow | null;
  if (
    !row ||
    row.status !== 'paid' ||
    row.shopify_sync_status !== 'pending' ||
    (row.shopify_sync_next_at && Date.parse(row.shopify_sync_next_at) > Date.now())
  )
    return 'not_due';

  const attempts = row.shopify_sync_attempts + 1;
  const { data: claimed, error: claimError } = await db
    .from('flow_payment_requests')
    .update({
      shopify_sync_attempts: attempts,
      shopify_sync_next_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
    })
    .eq('id', row.id)
    .eq('shopify_sync_status', 'pending')
    .eq('shopify_sync_attempts', row.shopify_sync_attempts)
    .select('id')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return 'not_due';

  const finish = async (status: 'synced' | 'failed', message: string | null) => {
    const { error: finishError } = await db
      .from('flow_payment_requests')
      .update({
        shopify_sync_status: status,
        shopify_sync_error: message,
        shopify_sync_next_at: null,
        ...(status === 'synced' ? { shopify_synced_at: new Date().toISOString() } : {}),
      })
      .eq('id', row.id);
    if (finishError) throw finishError;
    if (row.checkout_recovery_id) {
      const { error: resumeError } = await db.rpc('resume_checkout_payment', {
        p_request_id: row.id,
      });
      if (resumeError) throw resumeError;
    }
    if (status === 'failed')
      await db.from('flow_run_events').insert({
        flow_run_id: row.flow_run_id,
        event_type: 'error',
        node_key: row.node_key,
        payload: {
          reason: 'shopify_order_sync_failed',
          detail: message,
          shopify_order_id: row.shopify_order_id,
          payment_reference: row.id,
        },
      });
    return status;
  };

  try {
    if (row.checkout_recovery_id) {
      const order = await completeRecoveryOrder(
        db,
        row.checkout_recovery_id,
        row.account_id,
        { paymentRequestId: row.id }
      );
      const { error: orderError } = await db
        .from('flow_payment_requests')
        .update({ shopify_order_id: order.shopify_order_id })
        .eq('id', row.id);
      if (orderError) throw orderError;
      return await finish('synced', null);
    }
    const { shop, token } = await shopifyConnection(db, row.account_id);
    const state = await fetchOrderPaymentState(shop, token, row.shopify_order_id);
    if (!state) return await finish('failed', 'The Shopify order no longer exists.');
    if (state.cancelled)
      return await finish(
        'failed',
        'The Shopify order was cancelled after the customer paid. Refund the payment from the gateway if needed.'
      );
    const outstanding = toPaise(state.outstanding);
    if (outstanding > 0) {
      // An order edited upward after the link was sent must not be marked fully paid.
      if (state.currency !== 'INR' || !(outstanding <= row.amount_paise))
        return await finish(
          'failed',
          `The order balance (${state.currency} ${state.outstanding}) exceeds the ₹${(row.amount_paise / 100).toFixed(2)} collected. Review the order in Shopify.`
        );
      if (!state.canMarkAsPaid)
        return await finish('failed', 'Shopify does not allow this order to be marked as paid.');
      await markOrderAsPaid(shop, token, row.shopify_order_id);
    }
    const tag = (row.config?.shopify_paid_tag ?? DEFAULT_SHOPIFY_PAID_TAG).trim();
    await addOrderTags(shop, token, row.shopify_order_id, tag ? [tag] : []);
    return await finish('synced', null);
  } catch (err) {
    const message = syncErrorMessage(err);
    if (attempts >= MAX_SYNC_ATTEMPTS) return await finish('failed', message);
    await db
      .from('flow_payment_requests')
      .update({ shopify_sync_error: message })
      .eq('id', row.id);
    return 'retry';
  }
}

/** Cron sweep: retries order updates whose inline attempt failed or never ran. */
export async function processShopifyOrderSyncs(db: SupabaseClient): Promise<number> {
  const { data: releases, error: releaseError } = await db
    .from('flow_payment_requests')
    .select('id')
    .eq('status', 'paid')
    .not('checkout_recovery_id', 'is', null)
    .in('shopify_sync_status', ['synced', 'failed'])
    .is('checkout_branch_released_at', null)
    .limit(25);
  if (releaseError) throw releaseError;
  for (const payment of releases ?? []) {
    const { error } = await db.rpc('resume_checkout_payment', {
      p_request_id: payment.id,
    });
    if (error) throw error;
  }
  const { data, error } = await db
    .from('flow_payment_requests')
    .select('id')
    .eq('status', 'paid')
    .eq('shopify_sync_status', 'pending')
    .lte('shopify_sync_next_at', new Date().toISOString())
    .order('shopify_sync_next_at')
    .limit(25);
  if (error) throw error;
  let synced = 0;
  for (const { id } of data ?? []) {
    try {
      if ((await syncShopifyOrderPayment(db, id)) === 'synced') synced++;
    } catch {
      // A database error leaves the row pending for the next sweep.
    }
  }
  return synced;
}
