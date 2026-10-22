import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// A short "about this store" block for the system prompt.
//
// Without it, the agent knew individual products only when the
// customer's words matched a catalog search, so the most common opening
// question — "What do you sell?" — had no grounding and was handed off.
// This gives the model the brand name and a sample of what the synced
// catalog contains. It is reference data, never a promise of stock.
// ============================================================

const SAMPLE_ROWS = 200;
const MAX_TITLES = 25;

interface CatalogRow {
  title: string | null;
  price: string | number | null;
  currency: string | null;
}

export async function loadStoreProfile(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  try {
    const [{ data: account }, { data: store }, { data: rows, count }] =
      await Promise.all([
        db.from('accounts').select('name').eq('id', accountId).maybeSingle(),
        db
          .from('shopify_config')
          .select('shop_domain, status')
          .eq('account_id', accountId)
          .maybeSingle(),
        db
          .from('shopify_products')
          .select('title, price, currency', { count: 'exact' })
          .eq('account_id', accountId)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(SAMPLE_ROWS),
      ]);
    return formatStoreProfile({
      brandName: account?.name ?? null,
      shopDomain: store?.status === 'connected' ? store.shop_domain : null,
      rows: (rows ?? []) as CatalogRow[],
      variantCount: count ?? null,
    });
  } catch (err) {
    console.error('[ai store-profile] failed to load:', err);
    return null;
  }
}

export function formatStoreProfile(args: {
  brandName: string | null;
  shopDomain: string | null;
  rows: CatalogRow[];
  variantCount: number | null;
}): string | null {
  const titles: string[] = [];
  const seen = new Set<string>();
  const prices: number[] = [];
  const currencies = new Set<string>();
  for (const row of args.rows) {
    const price = Number(row.price);
    if (Number.isFinite(price) && price > 0) prices.push(price);
    if (row.currency) currencies.add(row.currency);
    const title = row.title?.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!title || seen.has(title.toLowerCase()) || titles.length >= MAX_TITLES) continue;
    seen.add(title.toLowerCase());
    titles.push(title);
  }

  const lines: string[] = [];
  if (args.brandName?.trim()) lines.push(`Brand: ${args.brandName.trim()}`);
  if (args.shopDomain) lines.push(`Shopify store: ${args.shopDomain}`);
  if (titles.length > 0) {
    if (args.variantCount) lines.push(`Active catalog variants: ${args.variantCount}`);
    if (prices.length > 0) {
      const currency = currencies.size === 1 ? `${[...currencies][0]} ` : '';
      lines.push(
        `Typical price range: ${currency}${Math.min(...prices)}–${Math.max(...prices)}`
      );
    }
    lines.push(`Sample of products sold: ${titles.join('; ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}
