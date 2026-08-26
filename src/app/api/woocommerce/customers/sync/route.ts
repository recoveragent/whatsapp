import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { loadWooCommerceCredentials } from '@/lib/woocommerce/load-config';
import {
  getBulkSyncProgress,
  runBulkCustomerSyncBatch,
} from '@/lib/woocommerce/sync-customers-bulk';

/**
 * GET /api/woocommerce/customers/sync — bulk customer sync progress.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const progress = await getBulkSyncProgress(ctx.supabase, ctx.accountId);
    return NextResponse.json({ progress });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/woocommerce/customers/sync — run the next batch of customer sync.
 * Call repeatedly until `done` is true. Re-running after completion restarts sync.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const creds = await loadWooCommerceCredentials(supabaseAdmin(), ctx.accountId);
    if (!creds) {
      return NextResponse.json({ error: 'WooCommerce is not connected' }, { status: 400 });
    }

    const result = await runBulkCustomerSyncBatch({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      ownerUserId: creds.userId,
      storeUrl: creds.storeUrl,
      consumerKey: creds.consumerKey,
      consumerSecret: creds.consumerSecret,
    });

    return NextResponse.json(result);
  } catch (err) {
    const progress =
      err && typeof err === 'object' && 'progress' in err
        ? (err as { progress: unknown }).progress
        : undefined;
    if (progress) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : 'Customer sync failed',
          progress,
        },
        { status: 500 },
      );
    }
    return toErrorResponse(err);
  }
}
