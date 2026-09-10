import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processDueAbandonedCheckouts } from '@/lib/shopify/handle-webhook';
import { processDueProductLinkRecoveries } from '@/lib/shopify/product-link-recovery';
import { syncEnabledShopifyProductCatalogs } from '@/lib/shopify/products-sync';

/**
 * GET /api/shopify/cron — drain due abandoned-checkout messages and
 * refresh Sell-on-WhatsApp product catalogs for enabled brands.
 * Protected by AUTOMATION_CRON_SECRET (same as automations cron).
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  const [processed, productSync, productLinkRecovery] = await Promise.all([
    processDueAbandonedCheckouts(db),
    syncEnabledShopifyProductCatalogs(db),
    processDueProductLinkRecoveries(db),
  ]);

  return NextResponse.json({
    processed,
    product_sync: productSync,
    product_link_recovery: productLinkRecovery,
  });
}
