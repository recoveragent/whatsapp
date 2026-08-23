import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { fetchFulfillmentStatusStats } from '@/lib/shopify/fulfillment-status-stats';

/**
 * GET /api/shopify/fulfillment-statuses?days=7
 * Recent shipment_status values received from Shopify fulfillment webhooks.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    const daysRaw = url.searchParams.get('days');
    const days = daysRaw ? Math.min(Math.max(Number(daysRaw) || 7, 1), 90) : 7;

    const stats = await fetchFulfillmentStatusStats({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      days,
    });

    return NextResponse.json(stats);
  } catch (err) {
    return toErrorResponse(err);
  }
}
