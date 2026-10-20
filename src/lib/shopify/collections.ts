import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

import {
  fetchCollectionProductIds,
  fetchCollections,
  type ShopifyCollectionSummary,
} from './admin-api';
import {
  getShopifyCatalogProductsForProductIds,
  type ShopifyCatalogProduct,
} from './product-store';

export const MAX_COLLECTION_PRODUCTS = 10;

async function loadShopifyCredentials(
  db: SupabaseClient,
  accountId: string,
): Promise<{ shopDomain: string; accessToken: string }> {
  const { data, error } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data?.shop_domain || !data.access_token || data.status !== 'connected') {
    throw new Error('Shopify is not connected for this workspace.');
  }

  return {
    shopDomain: data.shop_domain as string,
    accessToken: decrypt(data.access_token as string),
  };
}

export async function listShopifyCollections(
  db: SupabaseClient,
  accountId: string,
): Promise<ShopifyCollectionSummary[]> {
  const { shopDomain, accessToken } = await loadShopifyCredentials(db, accountId);
  return fetchCollections(shopDomain, accessToken);
}

/**
 * In-stock products from a Shopify collection, in collection order, using
 * the synced catalog for prices/images. `requireImage` drops products a
 * carousel card can't show.
 */
export async function resolveCollectionCatalogProducts(args: {
  db: SupabaseClient;
  accountId: string;
  collectionId: string | number;
  limit?: number;
  requireImage?: boolean;
}): Promise<ShopifyCatalogProduct[]> {
  const { shopDomain, accessToken } = await loadShopifyCredentials(args.db, args.accountId);
  const productIds = await fetchCollectionProductIds(shopDomain, accessToken, args.collectionId);
  const products = await getShopifyCatalogProductsForProductIds({
    db: args.db,
    accountId: args.accountId,
    productIds,
  });

  const limit = Math.min(Math.max(args.limit ?? MAX_COLLECTION_PRODUCTS, 1), MAX_COLLECTION_PRODUCTS);
  return products
    .filter((product) => !args.requireImage || Boolean(product.image_url?.trim()))
    .slice(0, limit);
}
