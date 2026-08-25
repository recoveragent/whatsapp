import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ensureAccountEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { encrypt } from '@/lib/whatsapp/encryption';
import { isLocalWebhookUrl } from '@/lib/shopify/format-api-error';
import { registerWooCommerceWebhooks, verifyWooCommerceCredentials } from './admin-api';
import { normalizeStoreUrl } from './normalize-store-url';

export interface PersistWooCommerceConfigInput {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  webhookCallbackUrl: string;
}

export type PersistWooCommerceConfigResult =
  | { ok: true; store: { name: string; url: string } }
  | { ok: false; status: number; error: string };

export async function persistWooCommerceConfig(
  input: PersistWooCommerceConfigInput,
): Promise<PersistWooCommerceConfigResult> {
  const storeUrl = normalizeStoreUrl(input.storeUrl);
  if (!storeUrl) {
    return { ok: false, status: 400, error: 'Invalid store URL' };
  }

  const consumerKey = input.consumerKey.trim();
  const consumerSecret = input.consumerSecret.trim();
  if (!consumerKey || !consumerSecret) {
    return { ok: false, status: 400, error: 'Consumer key and secret are required' };
  }

  const platformCheck = await ensureAccountEcommercePlatform(
    input.supabase,
    input.accountId,
    'woocommerce',
  );
  if (!platformCheck.ok) {
    return { ok: false, status: platformCheck.status, error: platformCheck.error };
  }

  const { data: shopifyRow } = await input.supabase
    .from('shopify_config')
    .select('account_id')
    .eq('account_id', input.accountId)
    .maybeSingle();

  if (shopifyRow) {
    return {
      ok: false,
      status: 409,
      error: 'This brand is configured for Shopify. Disconnect Shopify before connecting WooCommerce.',
    };
  }

  const { data: claimed } = await input.supabase
    .from('woocommerce_config')
    .select('account_id')
    .eq('store_url', storeUrl)
    .neq('account_id', input.accountId)
    .maybeSingle();

  if (claimed) {
    return {
      ok: false,
      status: 409,
      error: 'This WooCommerce store is already linked to another brand.',
    };
  }

  let storeInfo;
  try {
    storeInfo = await verifyWooCommerceCredentials({
      storeUrl,
      consumerKey,
      consumerSecret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WooCommerce API error';
    return { ok: false, status: 400, error: `Could not verify store: ${message}` };
  }

  const webhookSecret = crypto.randomBytes(24).toString('hex');

  try {
    await registerWooCommerceWebhooks({
      storeUrl,
      consumerKey,
      consumerSecret,
      callbackUrl: input.webhookCallbackUrl,
      webhookSecret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook registration failed';
    if (isLocalWebhookUrl(input.webhookCallbackUrl)) {
      console.warn(
        '[woocommerce] webhook registration skipped on localhost — deploy or use a public HTTPS URL for live webhooks:',
        message,
      );
    } else {
      return { ok: false, status: 400, error: `Webhook setup failed: ${message}` };
    }
  }

  const { error: upsertError } = await input.supabase.from('woocommerce_config').upsert(
    {
      account_id: input.accountId,
      user_id: input.userId,
      store_url: storeUrl,
      consumer_key: encrypt(consumerKey),
      consumer_secret: encrypt(consumerSecret),
      webhook_secret: encrypt(webhookSecret),
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  );

  if (upsertError) {
    console.error('[woocommerce] persist upsert failed:', upsertError);
    return { ok: false, status: 500, error: 'Failed to save configuration' };
  }

  return {
    ok: true,
    store: { name: storeInfo.store_name, url: storeInfo.store_url },
  };
}
