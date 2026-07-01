import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processDueAbandonedCheckouts } from '@/lib/shopify/handle-webhook';

/**
 * GET /api/shopify/cron — drain due abandoned-checkout messages.
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

  const processed = await processDueAbandonedCheckouts(supabaseAdmin());
  return NextResponse.json({ processed });
}
