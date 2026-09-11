import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

import { fetchProductsPage, type ShopifyProductPayload } from './admin-api';
import type { ShopifyProductVariantPayload } from './types';

export interface ShopifyProductSyncResult {
  status: 'success' | 'failed';
  upserted: number;
  archived: number;
  error_message?: string;
}

export type ShopifyProductUpsertRow = {
  account_id: string;
  shopify_product_id: number;
  shopify_variant_id: number;
  title: string;
  variant_title: string | null;
  handle: string | null;
  price: string;
  compare_at_price: string | null;
  currency: string | null;
  image_url: string | null;
  inventory_quantity: number | null;
  status: 'active' | 'archived' | 'draft';
  synced_at: string;
};

function productImageUrl(product: ShopifyProductPayload): string | null {
  const src =
    product.image?.src?.trim() ||
    product.images?.find((img) => img.src?.trim())?.src?.trim() ||
    null;
  return src || null;
}

/** Prefer the variant's assigned image; fall back to the product default. */
export function variantImageUrl(
  product: ShopifyProductPayload,
  variant: ShopifyProductVariantPayload,
): string | null {
  if (variant.image_id != null && product.images?.length) {
    const match = product.images.find((img) => img.id === variant.image_id);
    const src = match?.src?.trim();
    if (src) return src;
  }
  return productImageUrl(product);
}

/** Prefer first in-stock variant; fall back to the first variant. */
export function pickDefaultVariant(
  variants: ShopifyProductVariantPayload[],
): ShopifyProductVariantPayload | null {
  if (!variants.length) return null;

  const inStock = variants.filter((variant) => isShopifyVariantInStock(variant));
  return inStock[0] ?? variants[0] ?? null;
}

export function isShopifyVariantInStock(
  variant: ShopifyProductVariantPayload,
): boolean {
  if (variant.available === false) return false;
  if (
    variant.inventory_management &&
    variant.inventory_quantity != null &&
    variant.inventory_quantity <= 0
  ) {
    return false;
  }
  return true;
}

export function mapShopifyProductRows(args: {
  accountId: string;
  product: ShopifyProductPayload;
  currency: string | null;
}): ShopifyProductUpsertRow[] {
  if (!args.product.id) return [];

  const status =
    args.product.status === 'active' ||
    args.product.status === 'archived' ||
    args.product.status === 'draft'
      ? args.product.status
      : 'active';

  const title = args.product.title?.trim() || 'Untitled product';
  const syncedAt = new Date().toISOString();

  return (args.product.variants ?? [])
    .filter((variant) => variant.id != null)
    .map((variant) => ({
      account_id: args.accountId,
      shopify_product_id: args.product.id!,
      shopify_variant_id: variant.id,
      title,
      variant_title: variant.title?.trim() || null,
      handle: args.product.handle?.trim() || null,
      price: variant.price?.trim() || '0.00',
      compare_at_price: variant.compare_at_price?.trim() || null,
      currency: args.currency,
      image_url: variantImageUrl(args.product, variant),
      inventory_quantity:
        typeof variant.inventory_quantity === 'number'
          ? variant.inventory_quantity
          : null,
      status,
      synced_at: syncedAt,
    }));
}

/** @deprecated Use mapShopifyProductRows — kept for tests expecting one default row. */
export function mapShopifyProductRow(args: {
  accountId: string;
  product: ShopifyProductPayload;
  currency: string | null;
}) {
  const variant = pickDefaultVariant(args.product.variants ?? []);
  if (!variant?.id || !args.product.id) return null;

  const [row] = mapShopifyProductRows(args).filter(
    (item) => item.shopify_variant_id === variant.id,
  );
  return row ?? null;
}

async function loadConnectedShopifyConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<{ shop_domain: string; access_token: string } | null> {
  const { data, error } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data?.shop_domain || !data.access_token || data.status !== 'connected') {
    return null;
  }

  return {
    shop_domain: data.shop_domain as string,
    access_token: data.access_token as string,
  };
}

export async function syncShopifyProductsForAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<ShopifyProductSyncResult> {
  const config = await loadConnectedShopifyConfig(db, accountId);
  if (!config) {
    return {
      status: 'failed',
      upserted: 0,
      archived: 0,
      error_message: 'Shopify is not connected for this workspace.',
    };
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch {
    return {
      status: 'failed',
      upserted: 0,
      archived: 0,
      error_message: 'Failed to decrypt Shopify access token.',
    };
  }

  const { data: runRow, error: runInsertError } = await db
    .from('shopify_product_sync_runs')
    .insert({
      account_id: accountId,
      status: 'running',
    })
    .select('id')
    .single();

  if (runInsertError || !runRow?.id) {
    return {
      status: 'failed',
      upserted: 0,
      archived: 0,
      error_message: 'Failed to start product sync run.',
    };
  }

  const runId = runRow.id as string;

  try {
    const syncedProductIds = new Set<number>();
    const syncedVariantIds = new Set<number>();
    const rows: ShopifyProductUpsertRow[] = [];
    let currency: string | null = null;

    let pageInfo: string | null = null;
    do {
      const page = await fetchProductsPage({
        shopDomain: config.shop_domain,
        accessToken,
        pageInfo,
        status: 'active',
      });

      if (!currency && page.shopCurrency) {
        currency = page.shopCurrency;
      }

      for (const product of page.products) {
        if (!product.id) continue;
        syncedProductIds.add(product.id);
        for (const row of mapShopifyProductRows({ accountId, product, currency })) {
          syncedVariantIds.add(row.shopify_variant_id);
          rows.push(row);
        }
      }

      pageInfo = page.nextPageInfo;
    } while (pageInfo);

    let upserted = 0;
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db.from('shopify_products').upsert(chunk, {
        onConflict: 'account_id,shopify_variant_id',
      });
      if (error) throw new Error(error.message);
      upserted += chunk.length;
    }

    let archived = 0;
    if (syncedProductIds.size > 0) {
      const { data: staleRows, error: staleError } = await db
        .from('shopify_products')
        .select('id, shopify_product_id, shopify_variant_id, status')
        .eq('account_id', accountId)
        .eq('status', 'active');

      if (staleError) throw new Error(staleError.message);

      const staleIds = (staleRows ?? [])
        .filter((row) => {
          const productId =
            typeof row.shopify_product_id === 'number'
              ? row.shopify_product_id
              : null;
          const variantId =
            typeof row.shopify_variant_id === 'number'
              ? row.shopify_variant_id
              : null;
          if (productId == null || variantId == null) return false;
          return (
            !syncedProductIds.has(productId) || !syncedVariantIds.has(variantId)
          );
        })
        .map((row) => row.id as string);

      if (staleIds.length > 0) {
        const { error: archiveError } = await db
          .from('shopify_products')
          .update({
            status: 'archived',
            synced_at: new Date().toISOString(),
          })
          .in('id', staleIds);

        if (archiveError) throw new Error(archiveError.message);
        archived = staleIds.length;
      }
    }

    await db
      .from('shopify_product_sync_runs')
      .update({
        status: 'success',
        products_upserted: upserted,
        products_archived: archived,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    await db
      .from('shopify_config')
      .update({
        products_last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);

    return { status: 'success', upserted, archived };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Product sync failed';

    await db
      .from('shopify_product_sync_runs')
      .update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    return {
      status: 'failed',
      upserted: 0,
      archived: 0,
      error_message: message,
    };
  }
}

export async function syncEnabledShopifyProductCatalogs(
  db: SupabaseClient,
): Promise<{ synced: number; results: Array<{ account_id: string } & ShopifyProductSyncResult> }> {
  const { data: configs, error } = await db
    .from('shopify_config')
    .select('account_id')
    .eq('status', 'connected')
    .eq('sell_on_whatsapp_enabled', true);

  if (error || !configs?.length) {
    return { synced: 0, results: [] };
  }

  const results: Array<{ account_id: string } & ShopifyProductSyncResult> = [];

  for (const config of configs) {
    const accountId = config.account_id as string;
    const result = await syncShopifyProductsForAccount(db, accountId);
    results.push({ account_id: accountId, ...result });
  }

  return { synced: results.length, results };
}

export async function upsertShopifyProductFromWebhook(
  db: SupabaseClient,
  accountId: string,
  product: ShopifyProductPayload,
): Promise<boolean> {
  if (!product.id) return false;

  const { data: config } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status, sell_on_whatsapp_enabled')
    .eq('account_id', accountId)
    .maybeSingle();

  if (
    !config ||
    config.status !== 'connected' ||
    !config.sell_on_whatsapp_enabled
  ) {
    return false;
  }

  const { data: existing } = await db
    .from('shopify_products')
    .select('currency')
    .eq('account_id', accountId)
    .eq('shopify_product_id', product.id)
    .limit(1)
    .maybeSingle();

  const rows = mapShopifyProductRows({
    accountId,
    product,
    currency: (existing?.currency as string | null) ?? null,
  });
  if (!rows.length) {
    await archiveShopifyProductFromWebhook(db, accountId, product.id);
    return true;
  }

  const { error } = await db.from('shopify_products').upsert(rows, {
    onConflict: 'account_id,shopify_variant_id',
  });
  if (error) throw new Error(error.message);

  const variantIds = rows.map((row) => row.shopify_variant_id);
  const { error: archiveError } = await db
    .from('shopify_products')
    .update({
      status: 'archived',
      synced_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('shopify_product_id', product.id)
    .eq('status', 'active')
    .not('shopify_variant_id', 'in', `(${variantIds.join(',')})`);

  if (archiveError) throw new Error(archiveError.message);

  await db
    .from('shopify_config')
    .update({
      products_last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId);

  return true;
}

export async function archiveShopifyProductFromWebhook(
  db: SupabaseClient,
  accountId: string,
  shopifyProductId: number,
): Promise<void> {
  const { error } = await db
    .from('shopify_products')
    .update({
      status: 'archived',
      synced_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('shopify_product_id', shopifyProductId);

  if (error) throw new Error(error.message);
}
