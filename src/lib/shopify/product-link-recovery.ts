import type { SupabaseClient } from '@supabase/supabase-js';

import { sendShopifyProductCard } from './send-product-card';

export const PRODUCT_LINK_RECOVERY_DELAY_DEFAULT = 60;
export const PRODUCT_LINK_RECOVERY_DELAY_MIN = 5;
export const PRODUCT_LINK_RECOVERY_DELAY_MAX = 10080;

function clampDelayMinutes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return PRODUCT_LINK_RECOVERY_DELAY_DEFAULT;
  }
  return Math.min(
    PRODUCT_LINK_RECOVERY_DELAY_MAX,
    Math.max(PRODUCT_LINK_RECOVERY_DELAY_MIN, Math.floor(raw)),
  );
}

export async function scheduleProductLinkRecovery(args: {
  db: SupabaseClient;
  accountId: string;
  productSendId: string;
  conversationId: string;
  contactId: string | null;
  shopifyVariantId: number;
  productTitle: string;
  checkoutUrl: string;
}): Promise<void> {
  const { data: config } = await args.db
    .from('shopify_config')
    .select(
      'product_link_recovery_enabled, product_link_recovery_delay_minutes, sell_on_whatsapp_enabled, status',
    )
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (
    !config ||
    config.status !== 'connected' ||
    !config.sell_on_whatsapp_enabled ||
    !config.product_link_recovery_enabled
  ) {
    return;
  }

  const delayMinutes = clampDelayMinutes(config.product_link_recovery_delay_minutes);
  const runAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  const { error } = await args.db.from('shopify_pending_product_links').upsert(
    {
      account_id: args.accountId,
      product_send_id: args.productSendId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      shopify_variant_id: args.shopifyVariantId,
      product_title: args.productTitle,
      checkout_url: args.checkoutUrl,
      status: 'pending',
      run_at: runAt,
      error_message: null,
    },
    { onConflict: 'account_id,product_send_id' },
  );

  if (error) {
    console.error('[shopify] schedule product link recovery failed:', error);
  }
}

export async function cancelProductLinkRecoveryForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  await db
    .from('shopify_pending_product_links')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'pending');
}

export async function processDueProductLinkRecoveries(
  db: SupabaseClient,
): Promise<number> {
  const { data: due, error } = await db
    .from('shopify_pending_product_links')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50);

  if (error || !due?.length) return 0;

  let processed = 0;

  for (const row of due) {
    const { data: claim } = await db
      .from('shopify_pending_product_links')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (!claim) continue;

    const accountId = row.account_id as string;
    const conversationId = row.conversation_id as string;
    const shopifyVariantId = row.shopify_variant_id as number;

    const { data: config } = await db
      .from('shopify_config')
      .select('user_id, status, product_link_recovery_enabled, sell_on_whatsapp_enabled')
      .eq('account_id', accountId)
      .maybeSingle();

    if (
      !config ||
      config.status !== 'connected' ||
      !config.sell_on_whatsapp_enabled ||
      !config.product_link_recovery_enabled
    ) {
      await db
        .from('shopify_pending_product_links')
        .update({
          status: 'cancelled',
          error_message: 'recovery disabled or shopify disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      continue;
    }

    try {
      await sendShopifyProductCard({
        db,
        accountId,
        userId: config.user_id as string,
        conversationId,
        shopifyVariantId,
        skipAssigneeCheck: true,
        recoverySend: true,
        skipRecoverySchedule: true,
      });

      await db
        .from('shopify_pending_product_links')
        .update({
          status: 'sent',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'recovery send failed';
      await db
        .from('shopify_pending_product_links')
        .update({
          status: 'failed',
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
  }

  return processed;
}
