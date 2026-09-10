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

export interface ShopifyProductGroup {
  shopify_product_id: number;
  title: string;
  image_url: string | null;
  currency: string | null;
  variants: ShopifyCatalogProduct[];
}

const FLAT_SEARCH_DEFAULT = 50;
const FLAT_SEARCH_MAX = 200;
const GROUPED_VARIANT_FETCH_CAP = 2000;
const GROUPED_PRODUCT_DEFAULT = 100;
const GROUPED_PRODUCT_MAX = 200;

function rowToCatalogProduct(row: Record<string, unknown>): ShopifyCatalogProduct {
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

export function groupShopifyCatalogProducts(
  rows: ShopifyCatalogProduct[],
): ShopifyProductGroup[] {
  const byProduct = new Map<number, ShopifyProductGroup>();

  for (const row of rows) {
    const existing = byProduct.get(row.shopify_product_id);
    if (existing) {
      existing.variants.push(row);
      if (!existing.image_url && row.image_url) {
        existing.image_url = row.image_url;
      }
      if (!existing.currency && row.currency) {
        existing.currency = row.currency;
      }
      continue;
    }

    byProduct.set(row.shopify_product_id, {
      shopify_product_id: row.shopify_product_id,
      title: row.title,
      image_url: row.image_url,
      currency: row.currency,
      variants: [row],
    });
  }

  return Array.from(byProduct.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

function matchesCatalogQuery(
  row: ShopifyCatalogProduct,
  query: string,
): boolean {
  const needle = query.toLowerCase();
  if (row.title.toLowerCase().includes(needle)) return true;
  if (row.variant_title?.toLowerCase().includes(needle)) return true;
  return false;
}

async function fetchShopifyCatalogRows(args: {
  db: SupabaseClient;
  accountId: string;
  query?: string;
  limit: number;
}): Promise<ShopifyCatalogProduct[]> {

  let request = args.db
    .from('shopify_products')
    .select(
      'id, shopify_product_id, shopify_variant_id, title, variant_title, price, compare_at_price, currency, image_url, inventory_quantity',
    )
    .eq('account_id', args.accountId)
    .eq('status', 'active')
    .order('title', { ascending: true })
    .order('variant_title', { ascending: true })
    .limit(args.limit);

  const query = args.query?.trim();
  if (query) {
    const escaped = query.replace(/[%_,]/g, '');
    request = request.or(
      `title.ilike.%${escaped}%,variant_title.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) =>
    rowToCatalogProduct(row as Record<string, unknown>),
  );
}

export async function searchShopifyProducts(args: {
  db: SupabaseClient;
  accountId: string;
  query?: string;
  limit?: number;
  inStockOnly?: boolean;
}): Promise<ShopifyCatalogProduct[]> {
  const limit = Math.min(
    Math.max(args.limit ?? FLAT_SEARCH_DEFAULT, 1),
    FLAT_SEARCH_MAX,
  );

  const products = await fetchShopifyCatalogRows({
    db: args.db,
    accountId: args.accountId,
    query: args.query,
    limit,
  });

  if (args.inStockOnly === false) return products;
  return products.filter((product) => product.in_stock);
}

export async function searchShopifyProductGroups(args: {
  db: SupabaseClient;
  accountId: string;
  query?: string;
  limit?: number;
  inStockOnly?: boolean;
}): Promise<ShopifyProductGroup[]> {
  const productLimit = Math.min(
    Math.max(args.limit ?? GROUPED_PRODUCT_DEFAULT, 1),
    GROUPED_PRODUCT_MAX,
  );

  const rows = await fetchShopifyCatalogRows({
    db: args.db,
    accountId: args.accountId,
    query: args.query,
    limit: GROUPED_VARIANT_FETCH_CAP,
  });

  const inStockOnly = args.inStockOnly !== false;
  const filtered = inStockOnly ? rows.filter((row) => row.in_stock) : rows;
  const groups = groupShopifyCatalogProducts(filtered).map((group) => ({
    ...group,
    variants: inStockOnly
      ? group.variants.filter((variant) => variant.in_stock)
      : group.variants,
  }));

  const query = args.query?.trim();
  const matchedGroups = query
    ? groups.filter(
        (group) =>
          group.title.toLowerCase().includes(query.toLowerCase()) ||
          group.variants.some((variant) => matchesCatalogQuery(variant, query)),
      )
    : groups;

  return matchedGroups
    .filter((group) => group.variants.length > 0)
    .slice(0, productLimit);
}

export async function getShopifyCatalogProduct(args: {
  db: SupabaseClient;
  accountId: string;
  shopifyVariantId: string | number;
}): Promise<ShopifyCatalogProduct | null> {
  const { data, error } = await args.db
    .from('shopify_products')
    .select(
      'id, shopify_product_id, shopify_variant_id, title, variant_title, price, compare_at_price, currency, image_url, inventory_quantity',
    )
    .eq('account_id', args.accountId)
    .eq('shopify_variant_id', Number(args.shopifyVariantId))
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return rowToCatalogProduct(data as Record<string, unknown>);
}
