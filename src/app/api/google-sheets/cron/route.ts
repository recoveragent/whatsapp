import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { pollGoogleSheetFlows } from '@/lib/google-sheets/poll'

/**
 * GET /api/google-sheets/cron — poll connected Sheets for new rows.
 * Protected by AUTOMATION_CRON_SECRET (same as automations / Shopify cron).
 *
 * Also invoked from GET /api/automations/cron so Hostinger's documented
 * single cron job is enough for Sheet-triggered flows.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await pollGoogleSheetFlows(supabaseAdmin())
  return NextResponse.json(result)
}
