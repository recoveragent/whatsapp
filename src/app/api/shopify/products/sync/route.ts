import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { syncShopifyProductsForAccount } from '@/lib/shopify/products-sync';

/**
 * POST /api/shopify/products/sync
 * Pull active products from Shopify into the local catalog cache.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin');

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const result = await syncShopifyProductsForAccount(supabaseAdmin(), ctx.accountId);

    if (result.status === 'failed') {
      return NextResponse.json(
        {
          status: result.status,
          upserted: result.upserted,
          archived: result.archived,
          error: result.error_message ?? 'Product sync failed',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: result.status,
      upserted: result.upserted,
      archived: result.archived,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
