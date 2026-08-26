import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

export interface WooCommerceCredentials {
  accountId: string;
  userId: string;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export async function loadWooCommerceCredentials(
  db: SupabaseClient,
  accountId: string,
): Promise<WooCommerceCredentials | null> {
  const { data, error } = await db
    .from('woocommerce_config')
    .select('account_id, user_id, store_url, consumer_key, consumer_secret, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data || data.status !== 'connected') return null;
  if (!data.consumer_key || !data.consumer_secret || !data.store_url) return null;

  return {
    accountId: data.account_id as string,
    userId: data.user_id as string,
    storeUrl: data.store_url as string,
    consumerKey: decrypt(data.consumer_key as string),
    consumerSecret: decrypt(data.consumer_secret as string),
  };
}
