import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchCustomersPage, fetchCustomersTotal } from './admin-api';
import { syncWooCommerceCustomer } from './sync-customer';
import type { WooCommerceCustomerPayload } from './types';

const PAGE_SIZE = 100;
/** Pages processed per API call to avoid timeouts. */
const PAGES_PER_BATCH = 5;

export interface BulkSyncProgress {
  status: 'idle' | 'running' | 'completed' | 'failed';
  page: number;
  total: number | null;
  processed: number;
  skippedNoPhone: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export async function getBulkSyncProgress(
  db: SupabaseClient,
  accountId: string,
): Promise<BulkSyncProgress | null> {
  const { data } = await db
    .from('woocommerce_config')
    .select(
      'customer_sync_status, customer_sync_page, customer_sync_total, customer_sync_processed, customer_sync_skipped_no_phone, customer_sync_started_at, customer_sync_completed_at, customer_sync_error',
    )
    .eq('account_id', accountId)
    .maybeSingle();

  if (!data) return null;

  return {
    status: data.customer_sync_status as BulkSyncProgress['status'],
    page: (data.customer_sync_page as number) ?? 1,
    total: (data.customer_sync_total as number | null) ?? null,
    processed: (data.customer_sync_processed as number) ?? 0,
    skippedNoPhone: (data.customer_sync_skipped_no_phone as number) ?? 0,
    startedAt: (data.customer_sync_started_at as string | null) ?? null,
    completedAt: (data.customer_sync_completed_at as string | null) ?? null,
    error: (data.customer_sync_error as string | null) ?? null,
  };
}

export interface BulkSyncBatchResult {
  done: boolean;
  processedThisBatch: number;
  skippedThisBatch: number;
  progress: BulkSyncProgress;
}

export async function runBulkCustomerSyncBatch(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}): Promise<BulkSyncBatchResult> {
  const { db, accountId } = args;

  const { data: config } = await db
    .from('woocommerce_config')
    .select(
      'customer_sync_status, customer_sync_page, customer_sync_total, customer_sync_processed, customer_sync_skipped_no_phone, customer_sync_started_at',
    )
    .eq('account_id', accountId)
    .maybeSingle();

  if (!config) {
    throw new Error('WooCommerce is not configured');
  }

  let page = (config.customer_sync_page as number) ?? 1;
  let processed = (config.customer_sync_processed as number) ?? 0;
  let skippedNoPhone = (config.customer_sync_skipped_no_phone as number) ?? 0;
  let total = (config.customer_sync_total as number | null) ?? null;
  const wasIdle = config.customer_sync_status === 'idle' || config.customer_sync_status === 'completed';

  if (wasIdle || config.customer_sync_status === 'failed') {
    page = 1;
    processed = 0;
    skippedNoPhone = 0;
    total = await fetchCustomersTotal(args.storeUrl, args.consumerKey, args.consumerSecret);

    await db
      .from('woocommerce_config')
      .update({
        customer_sync_status: 'running',
        customer_sync_page: 1,
        customer_sync_total: total,
        customer_sync_processed: 0,
        customer_sync_skipped_no_phone: 0,
        customer_sync_started_at: new Date().toISOString(),
        customer_sync_completed_at: null,
        customer_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);
  } else if (config.customer_sync_status !== 'running') {
    const progress = await getBulkSyncProgress(db, accountId);
    return {
      done: true,
      processedThisBatch: 0,
      skippedThisBatch: 0,
      progress: progress!,
    };
  }

  let processedThisBatch = 0;
  let skippedThisBatch = 0;

  try {
    for (let i = 0; i < PAGES_PER_BATCH; i++) {
      const customers = await fetchCustomersPage(
        args.storeUrl,
        args.consumerKey,
        args.consumerSecret,
        page,
        PAGE_SIZE,
      );

      if (customers.length === 0) {
        await db
          .from('woocommerce_config')
          .update({
            customer_sync_status: 'completed',
            customer_sync_completed_at: new Date().toISOString(),
            customer_sync_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId);

        const progress = (await getBulkSyncProgress(db, accountId))!;
        return { done: true, processedThisBatch, skippedThisBatch, progress };
      }

      for (const customer of customers) {
        const result = await syncWooCommerceCustomer({
          db,
          accountId,
          ownerUserId: args.ownerUserId,
          customer: customer as WooCommerceCustomerPayload,
        });

        if (result.ok) {
          processed++;
          processedThisBatch++;
        } else if (result.skipped === 'no_phone') {
          skippedNoPhone++;
          skippedThisBatch++;
        }
      }

      page++;

      await db
        .from('woocommerce_config')
        .update({
          customer_sync_page: page,
          customer_sync_processed: processed,
          customer_sync_skipped_no_phone: skippedNoPhone,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId);

      if (customers.length < PAGE_SIZE) {
        await db
          .from('woocommerce_config')
          .update({
            customer_sync_status: 'completed',
            customer_sync_completed_at: new Date().toISOString(),
            customer_sync_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId);

        const progress = (await getBulkSyncProgress(db, accountId))!;
        return { done: true, processedThisBatch, skippedThisBatch, progress };
      }
    }

    const progress = (await getBulkSyncProgress(db, accountId))!;
    return { done: false, processedThisBatch, skippedThisBatch, progress };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Customer sync failed';
    await db
      .from('woocommerce_config')
      .update({
        customer_sync_status: 'failed',
        customer_sync_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);

    const progress = (await getBulkSyncProgress(db, accountId))!;
    throw Object.assign(new Error(message), { progress });
  }
}
