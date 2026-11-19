import type { SupabaseClient } from '@supabase/supabase-js';
import { queryShop } from '@/lib/ai/training-shopify';
import { decrypt } from '@/lib/whatsapp/encryption';

// Only a handle is accepted from the browser; it never controls the request host.
export function parseProductHandle(raw: unknown): string | null {
  return typeof raw === 'string' && /^[a-z0-9][a-z0-9-]{0,254}$/i.test(raw)
    ? raw.toLowerCase()
    : null;
}

export const CURRENT_PRODUCT_QUERY = `query WidgetCurrentProduct($identifier: ProductIdentifierInput!) {
  productByIdentifier(identifier: $identifier) {
    title
    description
    status
    onlineStoreUrl
    variants(first: 100) {
      nodes { id title price availableForSale selectedOptions { name value } }
      pageInfo { hasNextPage }
    }
  }
  shop { currencyCode }
}`;

export interface CurrentProduct {
  title: string;
  description: string;
  currency: string | null;
  variants: Array<{ id: string; title: string; price: string; availableForSale: boolean; options: Array<{ name: string; value: string }> }>;
  variantsTruncated: boolean;
  selectedVariantId: string | null;
}

export function parseVariantId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[1-9][0-9]{0,19}$/.test(raw) ? raw : null;
}

/** Returns only published product data from this widget account's connected shop. */
export async function loadCurrentProduct(
  db: SupabaseClient,
  accountId: string,
  handle: string,
  selectedVariantId?: string | null
): Promise<CurrentProduct | null> {
  if (!parseProductHandle(handle)) return null;
  try {
    const { data: store, error } = await db.from('shopify_config')
      .select('shop_domain, access_token, status')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !store || store.status !== 'connected' || !store.access_token) return null;
    const domain = String(store.shop_domain).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) return null;
    const token = decrypt(store.access_token);
    const data = await queryShop<{
      shop: { currencyCode: string };
      productByIdentifier: {
        title: string; description: string; status: string; onlineStoreUrl: string | null;
        variants: { nodes: Array<{ id: string; title: string; price: string; availableForSale: boolean; selectedOptions: Array<{ name: string; value: string }> }>; pageInfo: { hasNextPage: boolean } };
      } | null;
    }>(domain, token, CURRENT_PRODUCT_QUERY, AbortSignal.timeout(5000), { identifier: { handle } });
    const product = data.productByIdentifier;
    if (!product || product.status !== 'ACTIVE' || !product.onlineStoreUrl || typeof product.title !== 'string' || typeof product.description !== 'string') return null;
    const variants = (product.variants?.nodes ?? []).slice(0, 100).map((variant) => ({
      id: variant.id.replace(/^gid:\/\/shopify\/ProductVariant\//, ''),
      title: variant.title.slice(0, 200), price: variant.price,
      availableForSale: variant.availableForSale,
      options: variant.selectedOptions.map((option) => ({ name: option.name.slice(0, 100), value: option.value.slice(0, 200) })),
    }));
    const requestedId = parseVariantId(selectedVariantId);
    return {
      title: product.title.slice(0, 200), description: product.description.slice(0, 9000),
      currency: data.shop?.currencyCode ?? null, variants,
      variantsTruncated: product.variants?.pageInfo?.hasNextPage ?? false,
      selectedVariantId: requestedId && variants.some((variant) => variant.id === requestedId) ? requestedId : null,
    };
  } catch {
    // Product lookup is optional; do not break an otherwise available chat.
    return null;
  }
}
