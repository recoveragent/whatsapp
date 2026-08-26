import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { countWooCommerceSegment } from '@/lib/woocommerce/resolve-segment-audience';
import { WOOCOMMERCE_SEGMENTS, type WooCommerceSegmentKey } from '@/lib/woocommerce/segments';

/**
 * GET /api/woocommerce/customers/segments — audience segment definitions + counts.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const segments = await Promise.all(
      WOOCOMMERCE_SEGMENTS.map(async (segment) => ({
        ...segment,
        count: await countWooCommerceSegment(ctx.supabase, segment.key),
      })),
    );

    return NextResponse.json({ segments });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export type { WooCommerceSegmentKey };
