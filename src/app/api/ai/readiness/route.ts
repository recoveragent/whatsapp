import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import { fetchAccountWithCategory } from '@/lib/auth/brand-accounts';
import type { ReadinessFacts } from '@/lib/ai/readiness';

/**
 * GET /api/ai/readiness — facts behind the AI Agents go-live checklist.
 * Read-only and RLS-scoped. Playground testing is tracked in the
 * browser, so `playgroundTested` is always false here.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount();
    const account = await fetchAccountWithCategory(supabase, accountId);
    const onShopify = account?.ecommerce_platform === 'shopify';

    const [config, whatsapp, store, catalog, knowledge, automations] =
      await Promise.all([
        supabase
          .from('ai_configs')
          .select('api_key, system_prompt, is_active, auto_reply_enabled')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('whatsapp_config')
          .select('id')
          .eq('account_id', accountId)
          .eq('status', 'connected')
          .limit(1),
        supabase
          .from('shopify_config')
          .select('status')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('shopify_products')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', 'active'),
        supabase
          .from('ai_knowledge_documents')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId),
        supabase
          .from('automations')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('is_active', true)
          .eq('trigger_type', 'new_message_received'),
      ]);

    const shopifyConnected = store.data?.status === 'connected';
    const facts: ReadinessFacts = {
      modelConfigured: !!config.data?.api_key,
      whatsappConnected: (whatsapp.data?.length ?? 0) > 0,
      // Show the Shopify steps to Shopify brands, and to any brand that
      // has connected a store anyway.
      shopifyConnected: onShopify || store.data ? shopifyConnected : null,
      catalogVariants: catalog.error ? null : (catalog.count ?? 0),
      knowledgeDocuments: knowledge.count ?? 0,
      hasBusinessInstructions: !!config.data?.system_prompt?.trim(),
      playgroundTested: false,
      assistantOn: !!config.data?.is_active,
      autoReplyOn: !!config.data?.auto_reply_enabled,
      catchAllAutomations: automations.count ?? 0,
    };
    return NextResponse.json(facts);
  } catch (err) {
    return toErrorResponse(err);
  }
}
