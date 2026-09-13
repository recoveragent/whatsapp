import { NextResponse } from 'next/server';

import { isValidAutomationCronSecret } from '@/lib/automations/cron-secret';
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
  if (!process.env.AUTOMATION_CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isValidAutomationCronSecret(request.headers.get('x-cron-secret'))) {
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
