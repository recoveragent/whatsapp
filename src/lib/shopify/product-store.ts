import type { SupabaseClient } from '@supabase/supabase-js';

export interface ShopifyCatalogProduct {
  id: string;
  shopify_product_id: number;
  shopify_variant_id: number;
  title: string;
  variant_title: string | null;
  price: string;
  compare_at_price: string | null;
  currency: string | null;
  image_url: string | null;
  inventory_quantity: number | null;
  in_stock: boolean;
}

function rowToCatalogProduct(
  row: Record<string, unknown>
): ShopifyCatalogProduct {
  const inventoryQuantity =
    typeof row.inventory_quantity === 'number' ? row.inventory_quantity : null;

  return {
    id: String(row.id),
    shopify_product_id: Number(row.shopify_product_id),
    shopify_variant_id: Number(row.shopify_variant_id),
    title: String(row.title ?? ''),
    variant_title: (row.variant_title as string | null) ?? null,
    price: String(row.price ?? '0.00'),
    compare_at_price: (row.compare_at_price as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    image_url: (row.image_url as string | null) ?? null,
    inventory_quantity: inventoryQuantity,
    in_stock: inventoryQuantity == null || inventoryQuantity > 0,
  };
}

export async function searchShopifyProducts(args: {
  db: SupabaseClient;
  accountId: string;
  query?: string;
  limit?: number;
  inStockOnly?: boolean;
}): Promise<ShopifyCatalogProduct[]> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

  let request = args.db
    .from('shopify_products')
    .select(
      'id, shopify_product_id, shopify_variant_id, title, variant_title, price, compare_at_price, currency, image_url, inventory_quantity'
    )
    .eq('account_id', args.accountId)
    .eq('status', 'active')
    .order('title', { ascending: true })
    .order('variant_title', { ascending: true })
    .limit(limit);

  const query = args.query?.trim();
  if (query) {
    // This value is interpolated into PostgREST's filter grammar. Product
    // hints can come from imported docs, so remove grammar metacharacters.
    const escaped = query
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!escaped) return [];
    request = request.or(
      `title.ilike.%${escaped}%,variant_title.ilike.%${escaped}%`
    );
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);

  const products = (data ?? []).map((row) =>
    rowToCatalogProduct(row as Record<string, unknown>)
  );

  if (args.inStockOnly === false) return products;
  return products.filter((product) => product.in_stock);
}

export async function getShopifyCatalogProduct(args: {
  db: SupabaseClient;
  accountId: string;
  shopifyVariantId: string | number;
}): Promise<ShopifyCatalogProduct | null> {
  const { data, error } = await args.db
    .from('shopify_products')
    .select(
      'id, shopify_product_id, shopify_variant_id, title, variant_title, price, compare_at_price, currency, image_url, inventory_quantity'
    )
    .eq('account_id', args.accountId)
    .eq('shopify_variant_id', Number(args.shopifyVariantId))
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return rowToCatalogProduct(data as Record<string, unknown>);
}

/**
 * One cached variant per product, in the order of `productIds`. Prefers an
 * in-stock variant with an image; products with nothing in stock are dropped.
 */
export async function getShopifyCatalogProductsForProductIds(args: {
  db: SupabaseClient;
  accountId: string;
  productIds: number[];
}): Promise<ShopifyCatalogProduct[]> {
  if (args.productIds.length === 0) return [];

  const { data, error } = await args.db
    .from('shopify_products')
    .select(
      'id, shopify_product_id, shopify_variant_id, title, variant_title, price, compare_at_price, currency, image_url, inventory_quantity'
    )
    .eq('account_id', args.accountId)
    .eq('status', 'active')
    .in('shopify_product_id', args.productIds)
    .order('shopify_variant_id', { ascending: true });

  if (error) throw new Error(error.message);

  const byProduct = new Map<number, ShopifyCatalogProduct>();
  for (const row of data ?? []) {
    const product = rowToCatalogProduct(row as Record<string, unknown>);
    if (!product.in_stock) continue;
    const current = byProduct.get(product.shopify_product_id);
    if (!current || (!current.image_url && product.image_url)) {
      byProduct.set(product.shopify_product_id, product);
    }
  }

  return args.productIds.flatMap((id) => {
    const product = byProduct.get(id);
    return product ? [product] : [];
  });
}
