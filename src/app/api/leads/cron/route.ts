import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { processDueCadences } from '@/lib/leads/engine'
import { pollLeadSources } from '@/lib/leads/poll-sources'

/**
 * GET /api/leads/cron — poll campaign sheets, then run due cadence steps.
 * Same `x-cron-secret` as `/api/automations/cron`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const sheets = await pollLeadSources(admin)
  const cadences = await processDueCadences(admin)
  return NextResponse.json({ sheets, cadences })
}
