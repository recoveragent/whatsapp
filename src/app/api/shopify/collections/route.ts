import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { listShopifyCollections } from '@/lib/shopify/collections';

/**
 * GET /api/shopify/collections
 * Manual and automated Shopify collections for the flow builder.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const collections = await listShopifyCollections(supabaseAdmin(), ctx.accountId);
    return NextResponse.json({ collections });
  } catch (err) {
    return toErrorResponse(err);
  }
}
