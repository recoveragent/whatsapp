import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { resolveCollectionCatalogProducts } from '@/lib/shopify/collections';

/**
 * GET /api/shopify/collections/:id/products?limit=
 * The in-stock, image-bearing products a send-product node would show for
 * this collection right now.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid collection id' }, { status: 400 });
    }

    const limitRaw = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '', 10);
    const products = await resolveCollectionCatalogProducts({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      collectionId: id,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      requireImage: true,
    });

    return NextResponse.json({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}
