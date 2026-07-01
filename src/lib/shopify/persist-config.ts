import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';
import { fetchShopInfo, registerShopifyWebhooks } from './admin-api';
import { isLocalWebhookUrl } from './format-api-error';
import { normalizeShopDomain } from './normalize-shop';import { seedDefaultCampaigns } from './send-campaign';

export interface PersistShopifyConfigInput {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  shopDomain: string;
  accessToken: string;
  scopes?: string[];
  webhookCallbackUrl: string;
}

export type PersistShopifyConfigResult =
  | { ok: true; shop: { name: string; domain: string } }
  | { ok: false; status: number; error: string };

export async function persistShopifyConfig(
  input: PersistShopifyConfigInput,
): Promise<PersistShopifyConfigResult> {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  if (!shopDomain) {
    return { ok: false, status: 400, error: 'Invalid shop domain' };
  }

  if (!input.accessToken.trim()) {
    return { ok: false, status: 400, error: 'access_token is required' };
  }

  const { data: claimed } = await input.supabase
    .from('shopify_config')
    .select('account_id')
    .eq('shop_domain', shopDomain)
    .neq('account_id', input.accountId)
    .maybeSingle();

  if (claimed) {
    return {
      ok: false,
      status: 409,
      error: 'This Shopify store is already linked to another brand.',
    };
  }

  let shopInfo;
  try {
    shopInfo = await fetchShopInfo(shopDomain, input.accessToken.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Shopify API error';
    return { ok: false, status: 400, error: `Could not verify store: ${message}` };
  }

  try {
    await registerShopifyWebhooks({
      shopDomain,
      accessToken: input.accessToken.trim(),
      callbackUrl: input.webhookCallbackUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook registration failed';
    if (isLocalWebhookUrl(input.webhookCallbackUrl)) {
      console.warn(
        '[shopify] webhook registration skipped on localhost — deploy or use a public HTTPS URL for live webhooks:',
        message,
      );
    } else {
      return { ok: false, status: 400, error: `Webhook setup failed: ${message}` };
    }
  }
  const encryptedToken = encrypt(input.accessToken.trim());
  const scopes = input.scopes ?? [];

  const { error: upsertError } = await input.supabase.from('shopify_config').upsert(
    {
      account_id: input.accountId,
      user_id: input.userId,
      shop_domain: shopDomain,
      access_token: encryptedToken,
      scopes,
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  );

  if (upsertError) {
    console.error('[shopify] persist upsert failed:', upsertError);
    return { ok: false, status: 500, error: 'Failed to save configuration' };
  }

  await seedDefaultCampaigns(input.supabase, input.accountId);

  return {
    ok: true,
    shop: { name: shopInfo.name, domain: shopInfo.myshopify_domain ?? shopDomain },
  };
}

export async function createOAuthState(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  shopDomain: string;
}): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await args.db.from('shopify_oauth_states').insert({
    state_token: token,
    account_id: args.accountId,
    user_id: args.userId,
    shop_domain: args.shopDomain,
    expires_at: expiresAt,
  });

  if (error) throw new Error('Failed to create OAuth state');
  return token;
}

export async function consumeOAuthState(
  db: SupabaseClient,
  state: string,
): Promise<{
  account_id: string;
  user_id: string;
  shop_domain: string;
} | null> {
  const { data, error } = await db
    .from('shopify_oauth_states')
    .select('account_id, user_id, shop_domain, expires_at')
    .eq('state_token', state)
    .maybeSingle();

  await db.from('shopify_oauth_states').delete().eq('state_token', state);

  if (error || !data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;

  return {
    account_id: data.account_id as string,
    user_id: data.user_id as string,
    shop_domain: data.shop_domain as string,
  };
}
