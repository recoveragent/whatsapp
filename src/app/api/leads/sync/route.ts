import { NextResponse } from 'next/server'

import { requireLeadGenAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { processDueCadences } from '@/lib/leads/engine'
import { pollLeadSources } from '@/lib/leads/poll-sources'

/**
 * POST /api/leads/sync — pull new campaign-sheet rows and run due cadence
 * steps for the caller's brand. Same work as the cron, on demand.
 */
export async function POST() {
  try {
    const ctx = await requireLeadGenAccount('agent')
    const admin = supabaseAdmin()
    const sheets = await pollLeadSources(admin, {
      accountId: ctx.accountId,
      maxEnrolls: 40,
    })
    const cadences = await processDueCadences(admin, {
      accountId: ctx.accountId,
    })
    return NextResponse.json({ sheets, cadences })
  } catch (err) {
    if (err && typeof err === 'object' && 'message' in err) {
      const hint = leadsMigrationMessage(err as { message?: string; code?: string })
      if (hint) return NextResponse.json({ error: hint }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}
