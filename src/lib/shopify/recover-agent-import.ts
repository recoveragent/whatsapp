import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { RecoverAgentShopifyConnection } from '@/lib/auth/sso';
import { persistShopifyConfig } from './persist-config';

/**
 * Import the Shopify installation already owned by the Recover Agent
 * dashboard. The one-time SSO response is server-only; this function encrypts
 * the credentials into wacrm's normal shopify_config row and never returns
 * them to the browser.
 */
export async function importRecoverAgentShopifyConnection(args: {
  sessionClient: SupabaseClient;
  connection: RecoverAgentShopifyConnection;
  webhookCallbackUrl: string;
}): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await args.sessionClient.auth.getUser();
  if (userError || !user) throw new Error('Could not resolve the WhatsApp CRM user');

  const { data: profile, error: profileError } = await args.sessionClient
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) throw new Error('Could not resolve the WhatsApp CRM workspace');

  let accountId = profile?.account_id as string | null | undefined;
  if (!accountId) {
    const { data: actingAccountId } = await args.sessionClient.rpc(
      'get_super_admin_acting_account_id',
    );
    accountId = typeof actingAccountId === 'string' ? actingAccountId : null;
  }
  if (!accountId) throw new Error('Select a WhatsApp CRM brand before importing Shopify');

  const result = await persistShopifyConfig({
    supabase: supabaseAdmin(),
    userId: user.id,
    accountId,
    shopDomain: args.connection.shop_domain,
    accessToken: args.connection.access_token,
    apiKey: args.connection.client_id,
    apiSecret: args.connection.client_secret,
    scopes: [],
    webhookCallbackUrl: args.webhookCallbackUrl,
    keepExistingAppCredentials: true,
    allowWebhookRegistrationFailure: true,
    allowStoreReassignment: true,
  });

  if (!result.ok) throw new Error(result.error);
}
