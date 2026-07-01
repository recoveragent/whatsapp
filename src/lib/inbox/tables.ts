import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';

let privateNotesTableAvailable: boolean | null = null;
let shopifyOrdersTableAvailable: boolean | null = null;

async function tableExists(table: 'conversation_private_notes' | 'shopify_orders'): Promise<boolean> {
  const { error } = await supabaseAdmin().from(table).select('id').limit(1);
  if (!error) return true;
  const message = error.message ?? '';
  return !/does not exist|schema cache/i.test(message);
}

export async function hasPrivateNotesTable(): Promise<boolean> {
  if (privateNotesTableAvailable === null) {
    privateNotesTableAvailable = await tableExists('conversation_private_notes');
  }
  return privateNotesTableAvailable;
}

export async function hasShopifyOrdersTable(): Promise<boolean> {
  if (shopifyOrdersTableAvailable === null) {
    shopifyOrdersTableAvailable = await tableExists('shopify_orders');
  }
  return shopifyOrdersTableAvailable;
}

export async function loadConversationContactId(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('contact_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  return data?.contact_id ?? null;
}
