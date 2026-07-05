import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processDueFollowups } from '@/lib/inbox/followup'

/**
 * Drain due inbox follow-up messages. Hit on a schedule with the same
 * `x-cron-secret` header used by `/api/automations/cron`.
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

  try {
    const admin = supabaseAdmin()
    const result = await processDueFollowups(admin)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'cron failed'
    console.error('[inbox-followup-cron]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
