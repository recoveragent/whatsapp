import { NextResponse } from 'next/server'

import { isValidAutomationCronSecret } from '@/lib/automations/cron-secret'
import { runScheduledAutomationJobs } from '@/lib/automations/run-scheduled-jobs'

/**
 * Drain due `automation_pending_executions` rows, then poll Google Sheet
 * flow triggers. Meant to be hit on a schedule (Vercel Cron / Hostinger
 * cron / external pinger) — requires a shared secret via the
 * `x-cron-secret` header to match `AUTOMATION_CRON_SECRET`.
 *
 * Sheet → Flow polling used to live only on `/api/google-sheets/cron`.
 * Hostinger's documented job hits this automations URL, so sheet-backed
 * flows never fired unless a second cron was added. This endpoint is
 * the one operators actually schedule.
 *
 * Recover Agent ABC mirrors queue into `shopify_pending_checkouts` and
 * were only drained by `/api/shopify/cron`, which operators rarely
 * schedule separately — they are processed here too.
 *
 * Long-lived Node hosts (Hostinger, Docker) also run the same drain on
 * an in-process interval — see `src/instrumentation.ts`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  if (!process.env.AUTOMATION_CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!isValidAutomationCronSecret(request.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runScheduledAutomationJobs()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
