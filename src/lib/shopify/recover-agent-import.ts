import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { RecoverAgentShopifyConnection } from '@/lib/auth/sso';
import { persistShopifyConfig } from './persist-config';
import { loadChannelWorkspaces } from '@/lib/whatsapp/channel-workspace';
import { encrypt } from '@/lib/whatsapp/encryption';

export class ChannelImportPendingError extends Error {
  constructor(readonly brandAccountId: string, readonly userId: string) {
    super('Select a WhatsApp channel to finish connecting Shopify.');
  }
}

export async function deferShopifyChannelImport(args: {
  brandAccountId: string; userId: string; connection: RecoverAgentShopifyConnection; webhookCallbackUrl: string;
}) {
  const { error } = await supabaseAdmin().from('whatsapp_pending_shopify_imports').upsert({
    user_id: args.userId, brand_account_id: args.brandAccountId,
    encrypted_connection: encrypt(JSON.stringify(args.connection)),
    webhook_callback_url: args.webhookCallbackUrl,
  }, { onConflict: 'user_id,brand_account_id' });
  if (error) throw new Error('Could not save the Shopify connection for channel selection.');
}

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
  /** A queued import stays pinned to the channel chosen when it was claimed. */
  workspaceAccountId?: string;
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

  const channels = await loadChannelWorkspaces(args.sessionClient, accountId, user.id);
  const active = args.workspaceAccountId
    ? channels.channels.find((channel) => channel.accountId === args.workspaceAccountId) ?? null
    : channels.active;
  if (channels.migrationRequired || (channels.channels.length > 0 && !active)) {
    throw new ChannelImportPendingError(accountId, user.id);
  }
  accountId = active?.accountId ?? accountId;

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
    allowStoreReassignment: false,
  });

  if (!result.ok) throw new Error(result.error);
}
