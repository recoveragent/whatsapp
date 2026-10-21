import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecoverAgentWooCommerceConnection } from '@/lib/auth/sso';
import { fetchOrganizationMembership } from '@/lib/auth/organization';
import { canEditSettings, isAccountRole } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { persistWooCommerceConfig } from './persist-config';

/** Only called with credentials from the consumed server-to-server SSO response. */
export async function importRecoverAgentWooCommerceConnection(args: {
  sessionClient: SupabaseClient;
  connection: RecoverAgentWooCommerceConnection;
  webhookCallbackUrl: string;
}): Promise<void> {
  const { data: { user }, error } = await args.sessionClient.auth.getUser();
  if (error || !user) throw new Error('Could not resolve the WhatsApp CRM user');
  const { data: profile, error: profileError } = await args.sessionClient
    .from('profiles').select('account_id, account_role').eq('user_id', user.id).maybeSingle();
  if (profileError) throw new Error('Could not resolve the WhatsApp CRM workspace');
  const org = await fetchOrganizationMembership(args.sessionClient, user.id);
  const accountId = org ? org.actingAccountId : profile?.account_id;
  if (!accountId) throw new Error('Select a WhatsApp CRM brand before importing WooCommerce');
  if (!org && (!isAccountRole(profile?.account_role) || !canEditSettings(profile.account_role))) {
    throw new Error('A workspace admin must connect WooCommerce first');
  }
  const { data: account, error: accountError } = await args.sessionClient
    .from('accounts').select('id').eq('id', accountId).maybeSingle();
  if (accountError || !account) throw new Error('Could not access the WhatsApp CRM workspace');
  const result = await persistWooCommerceConfig({
    supabase: supabaseAdmin(), userId: user.id, accountId,
    storeUrl: args.connection.store_url,
    consumerKey: args.connection.consumer_key,
    consumerSecret: args.connection.consumer_secret,
    webhookCallbackUrl: args.webhookCallbackUrl,
    selectPlatformForSso: true,
  });
  // Provider errors can contain credentials or response bodies. Never surface
  // those through the SSO error page or logs.
  if (!result.ok) throw new Error('Could not sync WooCommerce. Check the store connection, API permissions and workspace platform, then retry from the dashboard.');
}
