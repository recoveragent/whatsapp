import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import {
  searchShopifyProductGroups,
  searchShopifyProducts,
} from '@/lib/shopify/product-store';

/**
 * GET /api/shopify/products?q=&limit=&grouped=
 * Search cached Shopify products for inbox picker and flows.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? undefined;
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const inStockOnly = url.searchParams.get('in_stock_only') !== 'false';
    const grouped = url.searchParams.get('grouped') === 'true';

    if (grouped) {
      const products = await searchShopifyProductGroups({
        db: ctx.supabase,
        accountId: ctx.accountId,
        query,
        limit: Number.isFinite(limit) ? limit : undefined,
        inStockOnly,
      });

      return NextResponse.json({ products });
    }

    const products = await searchShopifyProducts({
      db: ctx.supabase,
      accountId: ctx.accountId,
      query,
      limit: Number.isFinite(limit) ? limit : undefined,
      inStockOnly,
    });

    return NextResponse.json({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}
