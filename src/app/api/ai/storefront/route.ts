import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { decrypt } from '@/lib/whatsapp/encryption';
import { loadEmbeddingsKey } from '@/lib/ai/config';
import { ingestDocument } from '@/lib/ai/knowledge';
import {
  fetchStorefrontPolicies,
  storefrontDocumentId,
} from '@/lib/ai/storefront';

export async function GET() {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount();
    const { data: store, error } = await supabase
      .from('shopify_config')
      .select(
        'shop_domain, status, products_last_synced_at, sell_on_whatsapp_enabled'
      )
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!store) return NextResponse.json({ connected: false });
    const id = storefrontDocumentId(accountId, store.shop_domain);
    const [
      { data: document, error: docError },
      { count, error: productError },
      { count: chunks, error: chunkError },
    ] = await Promise.all([
      supabase
        .from('ai_knowledge_documents')
        .select('id, updated_at')
        .eq('account_id', accountId)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('shopify_products')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'active'),
      supabase
        .from('ai_knowledge_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('document_id', id),
    ]);
    return NextResponse.json({
      connected: store.status === 'connected',
      shop_domain: store.shop_domain,
      product_count: productError ? null : count,
      products_synced_at: store.products_last_synced_at,
      carousel_enabled: Boolean(store.sell_on_whatsapp_enabled),
      policies_imported_at:
        docError || chunkError || !chunks
          ? null
          : (document?.updated_at ?? null),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Imports/retrains only the managed policy document. Never enables auto-reply. */
export async function POST() {
  try {
    const { supabase, accountId, userId } =
      await requireAiAgentsAccount('admin');
    const limit = checkRateLimit(
      `ai-storefront:${accountId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data: store, error } = await supabase
      .from('shopify_config')
      .select('shop_domain, status, access_token')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (store?.status !== 'connected' || !store.access_token) {
      return NextResponse.json(
        { error: 'Connect your Shopify store first.' },
        { status: 400 }
      );
    }
    let content: string;
    try {
      content = await fetchStorefrontPolicies(
        store.shop_domain,
        decrypt(store.access_token)
      );
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : 'Store policy import failed.',
        },
        { status: 400 }
      );
    }
    const id = storefrontDocumentId(accountId, store.shop_domain);
    const { error: saveError } = await supabase
      .from('ai_knowledge_documents')
      .upsert(
        {
          id,
          account_id: accountId,
          created_by: userId,
          title: `Shopify storefront policies — ${store.shop_domain}`,
          content,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    if (saveError) throw saveError;
    const { key, corrupt } = await loadEmbeddingsKey(supabase, accountId);
    try {
      await ingestDocument(
        supabase,
        accountId,
        { embeddingsApiKey: key },
        id,
        content
      );
    } catch {
      return NextResponse.json(
        {
          error:
            'Policies were saved, but indexing did not finish. Use Reindex in Knowledge to retry.',
          saved: true,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      warning: corrupt
        ? 'Imported with keyword search. Re-enter your embeddings key to enable semantic search.'
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
